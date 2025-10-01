// FIX: The triple-slash directive below provides TypeScript with WebGPU type definitions, resolving errors about missing types like GPUDevice, GPUBuffer, etc.
/// <reference types="@webgpu/types" />

import type { Player, Invader, Laser, Particle, GameObject } from './types';
import { ModelType } from './types';
import { GAME_WIDTH, GAME_HEIGHT } from './constants';
import { mat4, vec3 } from 'gl-matrix';
import {
    cubeVertices, cubeIndices, cubeVsCode, cubeFsCode,
    playerShipVertices, playerShipIndices, playerShipVsCode, playerShipFsCode,
    invaderVertices, invaderIndices, invaderVsCode, invaderFsCode,
    laserVertices, laserIndices, laserVsCode, laserFsCode
} from './models';

const MAX_INSTANCES = 4096;

// WGSL struct memory layout for storage buffers:
// vec3f is aligned to 16 bytes (like vec4f)
// f32 is aligned to 4 bytes
// The entire struct must be a multiple of the largest member's alignment (16).
//
// model_pos: vec3f -> offset 0, size 12. Pad 4 bytes. Next offset: 16
// model_size: vec3f -> offset 16, size 12. Pad 4 bytes. Next offset: 32
// color: vec4f -> offset 32, size 16. Next offset: 48
// life: f32 -> offset 48, size 4. Next offset: 52
// initialLife: f32 -> offset 52, size 4. Next offset: 56
// End of data is 56. The struct must be padded to a multiple of 16.
// The next multiple of 16 after 56 is 64.
const INSTANCE_BYTE_SIZE = 64;

type Model = {
    vertices: Float32Array;
    indices: Uint16Array;
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
};

const invaderColors = [
  [236/255, 72/255, 153/255, 1.0],  // Pink
  [168/255, 85/255, 247/255, 1.0],   // Purple
  [250/255, 204/255, 21/255, 1.0],   // Yellow
  [34/255, 197/255, 94/255, 1.0],    // Green
  [249/255, 115/255, 22/255, 1.0],   // Orange
];
const playerColor = [0, 255/255, 255/255, 1.0];
const playerLaserColor = [52/255, 211/255, 153/255, 1.0];
const invaderLaserColor = [239/255, 68/255, 68/255, 1.0];

type GameObjects = {
    player: Player;
    invaders: Invader[];
    playerLasers: Laser[];
    invaderLasers: Laser[];
    particles: Particle[];
};

export class WebGPURenderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private pipelines!: Map<ModelType, GPURenderPipeline>;
    private presentationFormat!: GPUTextureFormat;
    private depthTexture!: GPUTexture;

    private models!: Map<ModelType, Model>;
    private uniformBuffer!: GPUBuffer;
    private instanceBuffer!: GPUBuffer;

    private uniformBindGroup!: GPUBindGroup;
    private instanceData: Float32Array;

    // 3D Camera matrices
    private projectionMatrix: mat4;
    private viewMatrix: mat4;
    private viewProjectionMatrix: mat4;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.instanceData = new Float32Array(MAX_INSTANCES * (INSTANCE_BYTE_SIZE / 4));

        this.projectionMatrix = mat4.create();
        this.viewMatrix = mat4.create();
        this.viewProjectionMatrix = mat4.create();
    }

    async init(): Promise<boolean> {
        if (!navigator.gpu) {
            console.error("WebGPU not supported on this browser.");
            return false;
        }
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            console.error("Failed to get GPU adapter.");
            return false;
        }
        this.device = await adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu')!;
        
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            alphaMode: 'premultiplied',
        });

        this.depthTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        // Create models
        this.models = new Map<ModelType, Model>();
        const modelData = [
            { type: ModelType.Cube, vertices: cubeVertices, indices: cubeIndices },
            { type: ModelType.PlayerShip, vertices: playerShipVertices, indices: playerShipIndices },
            { type: ModelType.Invader, vertices: invaderVertices, indices: invaderIndices },
            { type: ModelType.Laser, vertices: laserVertices, indices: laserIndices },
        ];

        for (const data of modelData) {
            const vertexBuffer = this.device.createBuffer({
                size: data.vertices.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                mappedAtCreation: true,
            });
            new Float32Array(vertexBuffer.getMappedRange()).set(data.vertices);
            vertexBuffer.unmap();

            const indexBuffer = this.device.createBuffer({
                size: data.indices.byteLength,
                usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
                mappedAtCreation: true,
            });
            new Uint16Array(indexBuffer.getMappedRange()).set(data.indices);
            indexBuffer.unmap();

            this.models.set(data.type, {
                vertices: data.vertices,
                indices: data.indices,
                vertexBuffer,
                indexBuffer,
            });
        }
        
        // Create buffers
        this.uniformBuffer = this.device.createBuffer({
            size: 64, // mat4x4<f32> is 4*4*4 = 64 bytes
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.instanceBuffer = this.device.createBuffer({
            size: MAX_INSTANCES * INSTANCE_BYTE_SIZE,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Create bind group
        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }
            ]
        });

        this.uniformBindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.instanceBuffer } },
            ]
        });

        // Create pipelines
        this.pipelines = new Map<ModelType, GPURenderPipeline>();
        const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

        const defaultBlendState: GPUBlendState = {
            color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
            },
            alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
            }
        };

        const additiveBlendState: GPUBlendState = {
            color: {
                srcFactor: 'src-alpha', // or 'one' for even brighter effect
                dstFactor: 'one',
                operation: 'add',
            },
            alpha: {
                srcFactor: 'one',
                dstFactor: 'one',
                operation: 'add',
            }
        };

        const createPipeline = (vsCode: string, fsCode: string, blend: GPUBlendState) => {
            const vsModule = this.device.createShaderModule({ code: vsCode });
            const fsModule = this.device.createShaderModule({ code: fsCode });

            return this.device.createRenderPipeline({
                layout: pipelineLayout,
                vertex: {
                    module: vsModule,
                    entryPoint: 'main',
                    buffers: [{
                        arrayStride: 6 * 4, // 3 floats for position, 3 for normal
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
                            { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' }, // normal
                        ],
                    }],
                },
                fragment: {
                    module: fsModule,
                    entryPoint: 'main',
                    targets: [{ 
                        format: this.presentationFormat,
                        blend: blend
                    }],
                },
                primitive: { topology: 'triangle-list' },
                depthStencil: {
                    depthWriteEnabled: true,
                    depthCompare: 'less',
                    format: 'depth24plus',
                },
            });
        }

        // Create a separate pipeline for particles with additive blending
        this.pipelines.set(ModelType.Cube, createPipeline(cubeVsCode, cubeFsCode, additiveBlendState));
        
        // Other models use the default alpha blending
        this.pipelines.set(ModelType.Invader, createPipeline(invaderVsCode, invaderFsCode, defaultBlendState));
        this.pipelines.set(ModelType.Laser, createPipeline(laserVsCode, laserFsCode, defaultBlendState));
        this.pipelines.set(ModelType.PlayerShip, createPipeline(playerShipVsCode, playerShipFsCode, defaultBlendState));

        return true;
    }

    private updateCamera(cameraYOffset: number) {
        const fieldOfView = 60 * Math.PI / 180;
        const aspect = this.canvas.width / this.canvas.height;
        const zNear = 1;
        const zFar = 2000;
        mat4.perspective(this.projectionMatrix, fieldOfView, aspect, zNear, zFar);

        const eye = vec3.fromValues(
            GAME_WIDTH / 2,
            120 + cameraYOffset,
            600 
        );
        const center = vec3.fromValues(
            GAME_WIDTH / 2,
            290,
            0
        );
        const up = vec3.fromValues(0, 1, 0);
        
        mat4.lookAt(this.viewMatrix, eye, center, up);

        mat4.multiply(this.viewProjectionMatrix, this.projectionMatrix, this.viewMatrix);
    }

    render(gameObjects: GameObjects, cameraYOffset: number): void {
        if (!this.device || !this.models) return;

        this.updateCamera(cameraYOffset);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.viewProjectionMatrix as Float32Array);

        const objectsByModel = new Map<ModelType, GameObject[]>();
        const allObjects = [
            gameObjects.player,
            ...gameObjects.invaders,
            ...gameObjects.playerLasers,
            ...gameObjects.invaderLasers,
            ...gameObjects.particles,
        ];

        for (const obj of allObjects) {
            if (!obj) continue;
            if (!objectsByModel.has(obj.modelType)) {
                objectsByModel.set(obj.modelType, []);
            }
            objectsByModel.get(obj.modelType)!.push(obj);
        }

        let instanceCount = 0;
        const instanceFloatSize = INSTANCE_BYTE_SIZE / 4;
        for (const objects of objectsByModel.values()) {
            for (const obj of objects) {
                const offset = instanceCount * instanceFloatSize;
                if (offset >= this.instanceData.length) continue;

                let color: number[];
                let life = 0.0;
                let initialLife = 0.0;

                if (obj.modelType === ModelType.Cube && 'initialLife' in obj) { // It's a particle
                    const p = obj as Particle;
                    color = p.color; // The initial color is passed in
                    life = p.life;
                    initialLife = p.initialLife;
                } else if (obj.modelType === ModelType.PlayerShip) {
                    color = playerColor;
                } else if (obj.modelType === ModelType.Invader) {
                    color = invaderColors[(obj as Invader).type % invaderColors.length];
                } else if (obj.modelType === ModelType.Laser) {
                    if (gameObjects.playerLasers.some(l => l.id === obj.id)) {
                        color = playerLaserColor;
                    } else {
                        color = invaderLaserColor;
                    }
                } else { // Default for non-particle cubes
                    color = [1, 1, 1, 1];
                }

                const worldY = obj.position.y + obj.size.height / 2;
                
                // Correctly populate the buffer according to WGSL std140/storage buffer layout rules
                let float_offset = offset;
                this.instanceData.set([obj.position.x + obj.size.width / 2, worldY, obj.position.z + obj.size.depth / 2], float_offset); // model_pos
                float_offset += 4; // Advance past vec3 + padding

                this.instanceData.set([obj.size.width, obj.size.height, obj.size.depth], float_offset); // model_size
                float_offset += 4; // Advance past vec3 + padding

                this.instanceData.set(color, float_offset); // color
                float_offset += 4; // Advance past vec4

                this.instanceData[float_offset++] = life;
                this.instanceData[float_offset++] = initialLife;

                instanceCount++;
            }
        }

        this.device.queue.writeBuffer(this.instanceBuffer, 0, this.instanceData, 0, instanceCount * instanceFloatSize);

        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();
        
        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: this.depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setBindGroup(0, this.uniformBindGroup);

        let drawnInstances = 0;
        for (const [modelType, objects] of objectsByModel.entries()) {
            const model = this.models.get(modelType);
            const pipeline = this.pipelines.get(modelType);
            if (!model || !pipeline || objects.length === 0) continue;

            passEncoder.setPipeline(pipeline);
            passEncoder.setVertexBuffer(0, model.vertexBuffer);
            passEncoder.setIndexBuffer(model.indexBuffer, 'uint16');
            passEncoder.drawIndexed(model.indices.length, objects.length, 0, 0, drawnInstances);
            
            drawnInstances += objects.length;
        }

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
