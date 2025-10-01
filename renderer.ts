// FIX: The triple-slash directive below provides TypeScript with WebGPU type definitions, resolving errors about missing types like GPUDevice, GPUBuffer, etc.
/// <reference types="@webgpu/types" />

import type { Player, Invader, Laser, Particle, GameObject } from './types';
import { ModelType } from './types';
import { GAME_WIDTH, GAME_HEIGHT } from './constants';
import { mat4, vec3 } from 'gl-matrix';
import { cubeVertices, cubeIndices, playerShipVertices, playerShipIndices, invaderVertices, invaderIndices, laserVertices, laserIndices } from './models';

const MAX_INSTANCES = 4096;
// pos(vec3f), size(vec3f), color(vec4f) -> 12 + 12 + 16 = 40 bytes
const INSTANCE_BYTE_SIZE = 48; 

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

const vsCode = `
struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) normal: vec3<f32>,
};

struct InstanceInput {
    model_pos: vec3<f32>,
    model_size: vec3<f32>,
    color: vec4<f32>,
};

struct Globals {
    view_proj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> instances: array<InstanceInput>;

@vertex
fn main(
    @builtin(instance_index) instance_index : u32,
    vert: VertexInput
) -> VertexOutput {
    let instance = instances[instance_index];
    
    let world_pos = vec4<f32>(
        (vert.position * instance.model_size) + instance.model_pos,
        1.0
    );
    
    var out: VertexOutput;
    out.position = globals.view_proj * world_pos;
    out.color = instance.color;
    out.normal = vert.normal; // Pass the normal for lighting calculations
    return out;
}
`;

const fsCode = `
@fragment
fn main(
    @location(0) color: vec4<f32>,
    @location(1) normal: vec3<f32>
) -> @location(0) vec4<f32> {
    // A new light direction that works well with our camera angle.
    // It shines from slightly to the side, from above, and from the front.
    let light_direction = normalize(vec3<f32>(0.3, 0.6, 0.7));

    // A minimum brightness of 0.25 ensures cubes are never completely black (ambient light).
    let diffuse_strength = max(dot(normal, light_direction), 0.25);
    
    let final_color = color.rgb * diffuse_strength;
    return vec4<f32>(final_color, color.a);
}
`;

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
    private pipeline!: GPURenderPipeline;
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

        const vsModule = this.device.createShaderModule({ code: vsCode });
        const fsModule = this.device.createShaderModule({ code: fsCode });

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
        
        this.uniformBuffer = this.device.createBuffer({
            size: 64, // mat4x4<f32> is 4*4*4 = 64 bytes
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.instanceBuffer = this.device.createBuffer({
            size: MAX_INSTANCES * INSTANCE_BYTE_SIZE,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
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

        const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
        
        this.pipeline = this.device.createRenderPipeline({
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
                    blend: {
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
                    }
                }],
            },
            primitive: { topology: 'triangle-list' },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth24plus',
            },
        });

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
        for (const objects of objectsByModel.values()) {
            for (const obj of objects) {
                const offset = instanceCount * (INSTANCE_BYTE_SIZE / 4);
                if (offset >= this.instanceData.length) continue;

                let color: number[];
                if ('color' in obj && (obj as Particle).color) {
                    const p = obj as Particle;
                    const alpha = Math.max(0, p.life * 2);
                    color = [p.color[0], p.color[1], p.color[2], Math.min(p.color[3], alpha)];
                } else if (obj.modelType === ModelType.PlayerShip || obj.modelType === ModelType.Cube) {
                    color = playerColor;
                } else if (obj.modelType === ModelType.Invader) {
                    color = invaderColors[(obj as Invader).type % invaderColors.length];
                } else if (obj.modelType === ModelType.Laser) {
                    if (gameObjects.playerLasers.some(l => l.id === obj.id)) {
                        color = playerLaserColor;
                    } else {
                        color = invaderLaserColor;
                    }
                } else {
                    color = [1, 1, 1, 1]; // Default white
                }

                const worldY = obj.position.y + obj.size.height / 2;
                this.instanceData[offset + 0] = obj.position.x + obj.size.width / 2;
                this.instanceData[offset + 1] = worldY;
                this.instanceData[offset + 2] = obj.position.z + obj.size.depth / 2;
                this.instanceData[offset + 4] = obj.size.width;
                this.instanceData[offset + 5] = obj.size.height;
                this.instanceData[offset + 6] = obj.size.depth;
                this.instanceData[offset + 8] = color[0];
                this.instanceData[offset + 9] = color[1];
                this.instanceData[offset + 10] = color[2];
                this.instanceData[offset + 11] = color[3];
                instanceCount++;
            }
        }

        this.device.queue.writeBuffer(this.instanceBuffer, 0, this.instanceData, 0, instanceCount * (INSTANCE_BYTE_SIZE / 4));

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
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.uniformBindGroup);

        let drawnInstances = 0;
        for (const [modelType, objects] of objectsByModel.entries()) {
            const model = this.models.get(modelType);
            if (!model || objects.length === 0) continue;

            passEncoder.setVertexBuffer(0, model.vertexBuffer);
            passEncoder.setIndexBuffer(model.indexBuffer, 'uint16');
            passEncoder.drawIndexed(model.indices.length, objects.length, 0, 0, drawnInstances);
            
            drawnInstances += objects.length;
        }

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}