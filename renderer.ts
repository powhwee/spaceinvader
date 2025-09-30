// FIX: The triple-slash directive below provides TypeScript with WebGPU type definitions, resolving errors about missing types like GPUDevice, GPUBuffer, etc.
/// <reference types="@webgpu/types" />

import type { Player, Invader, Laser, Particle, GameObject } from './types';
import { GAME_WIDTH, GAME_HEIGHT } from './constants';
import { mat4, vec3 } from 'gl-matrix';

const MAX_INSTANCES = 4096;
// pos(vec3f), size(vec3f), color(vec4f) -> 12 + 12 + 16 = 40 bytes
const INSTANCE_BYTE_SIZE = 48; 

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


// 3D Cube data (vertices and normals)
const cubeVertices = new Float32Array([
    //-z
    -0.5, -0.5, -0.5, 0.0, 0.0, -1.0,
     0.5, -0.5, -0.5, 0.0, 0.0, -1.0,
     0.5,  0.5, -0.5, 0.0, 0.0, -1.0,
    -0.5,  0.5, -0.5, 0.0, 0.0, -1.0,
    //+z
    -0.5, -0.5, 0.5, 0.0, 0.0, 1.0,
     0.5, -0.5, 0.5, 0.0, 0.0, 1.0,
     0.5,  0.5, 0.5, 0.0, 0.0, 1.0,
    -0.5,  0.5, 0.5, 0.0, 0.0, 1.0,
    //-x
    -0.5, -0.5, -0.5, -1.0, 0.0, 0.0,
    -0.5,  0.5, -0.5, -1.0, 0.0, 0.0,
    -0.5,  0.5,  0.5, -1.0, 0.0, 0.0,
    -0.5, -0.5,  0.5, -1.0, 0.0, 0.0,
    //+x
     0.5, -0.5, -0.5, 1.0, 0.0, 0.0,
     0.5,  0.5, -0.5, 1.0, 0.0, 0.0,
     0.5,  0.5,  0.5, 1.0, 0.0, 0.0,
     0.5, -0.5,  0.5, 1.0, 0.0, 0.0,
    //-y
    -0.5, -0.5, -0.5, 0.0, -1.0, 0.0,
     0.5, -0.5, -0.5, 0.0, -1.0, 0.0,
     0.5, -0.5,  0.5, 0.0, -1.0, 0.0,
    -0.5, -0.5,  0.5, 0.0, -1.0, 0.0,
    //+y
    -0.5,  0.5, -0.5, 0.0, 1.0, 0.0,
     0.5,  0.5, -0.5, 0.0, 1.0, 0.0,
     0.5,  0.5,  0.5, 0.0, 1.0, 0.0,
    -0.5,  0.5,  0.5, 0.0, 1.0, 0.0,
]);

const cubeIndices = new Uint16Array([
    0, 1, 2, 0, 2, 3, // -z
    4, 5, 6, 4, 6, 7, // +z
    8, 9, 10, 8, 10, 11, // -x
    12, 13, 14, 12, 14, 15, // +x
    16, 17, 18, 16, 18, 19, // -y
    20, 21, 22, 20, 22, 23, // +y
]);


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

    private vertexBuffer!: GPUBuffer;
    private indexBuffer!: GPUBuffer;
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

        this.vertexBuffer = this.device.createBuffer({
            size: cubeVertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(this.vertexBuffer.getMappedRange()).set(cubeVertices);
        this.vertexBuffer.unmap();

        this.indexBuffer = this.device.createBuffer({
            size: cubeIndices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Uint16Array(this.indexBuffer.getMappedRange()).set(cubeIndices);
        this.indexBuffer.unmap();
        
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
        const aspect = GAME_WIDTH / GAME_HEIGHT;
        const zNear = 1;
        const zFar = 2000;
        mat4.perspective(this.projectionMatrix, fieldOfView, aspect, zNear, zFar);

        const eye = vec3.fromValues(
            GAME_WIDTH / 2,
            120,
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
        if (!this.device) return;

        this.updateCamera(cameraYOffset);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.viewProjectionMatrix as Float32Array);

        let instanceCount = 0;
        const addInstance = (obj: GameObject, color: number[]) => {
            if (instanceCount >= MAX_INSTANCES) return;
            const offset = instanceCount * (INSTANCE_BYTE_SIZE / 4);

            const worldY = obj.position.y + obj.size.height / 2;

            // Center position
            this.instanceData[offset + 0] = obj.position.x + obj.size.width / 2;
            this.instanceData[offset + 1] = worldY;
            this.instanceData[offset + 2] = obj.position.z + obj.size.depth / 2;
            // Size
            this.instanceData[offset + 4] = obj.size.width;
            this.instanceData[offset + 5] = obj.size.height;
            this.instanceData[offset + 6] = obj.size.depth;
            // Color
            this.instanceData[offset + 8] = color[0];
            this.instanceData[offset + 9] = color[1];
            this.instanceData[offset + 10] = color[2];
            this.instanceData[offset + 11] = color[3];
            instanceCount++;
        };

        addInstance(gameObjects.player, playerColor);
        gameObjects.invaders.forEach(inv => addInstance(inv, invaderColors[inv.type % invaderColors.length]));
        // Lasers and particles will be rendered as cubes for now.
        gameObjects.playerLasers.forEach(laser => addInstance(laser, playerLaserColor));
        gameObjects.invaderLasers.forEach(laser => addInstance(laser, invaderLaserColor));
        gameObjects.particles.forEach(p => {
            const alpha = Math.max(0, p.life * 2);
            const fadedColor = [p.color[0], p.color[1], p.color[2], Math.min(p.color[3], alpha)];
            addInstance(p, fadedColor);
        });

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
        passEncoder.setVertexBuffer(0, this.vertexBuffer);
        passEncoder.setIndexBuffer(this.indexBuffer, 'uint16');
        passEncoder.drawIndexed(cubeIndices.length, instanceCount, 0, 0, 0);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }
}
