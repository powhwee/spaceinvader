// FIX: The triple-slash directive below provides TypeScript with WebGPU type definitions, resolving errors about missing types like GPUDevice, GPUBuffer, etc.
/// <reference types="@webgpu/types" />

import type { Player, Invader, Laser, Particle, GameObject } from './types';
import { GAME_WIDTH, GAME_HEIGHT } from './constants';
import { mat4, vec3 } from 'gl-matrix';

const MAX_INSTANCES = 4096;
const INSTANCE_BYTE_SIZE = 32; // pos(vec2f), size(vec2f), color(vec4f) -> 8 + 8 + 16

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
    @location(0) position: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

struct InstanceInput {
    model_pos: vec2<f32>,
    model_size: vec2<f32>,
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
    
    // Treat the 2D game as being on the XY plane in 3D space
    let world_pos = vec4<f32>(
        (vert.position.x * instance.model_size.x) + instance.model_pos.x,
        (vert.position.y * instance.model_size.y) + instance.model_pos.y,
        0.0,
        1.0
    );
    
    var out: VertexOutput;
    out.position = globals.view_proj * world_pos;
    out.color = instance.color;
    return out;
}
`;

const fsCode = `
@fragment
fn main(
    @location(0) color: vec4<f32>
) -> @location(0) vec4<f32> {
    return color;
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

    private vertexBuffer!: GPUBuffer;
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

        const vsModule = this.device.createShaderModule({ code: vsCode });
        const fsModule = this.device.createShaderModule({ code: fsCode });

        const quadVertices = new Float32Array([
            -0.5, -0.5,
             0.5, -0.5,
            -0.5,  0.5,
            0.5,  0.5,
        ]);
        this.vertexBuffer = this.device.createBuffer({
            size: quadVertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(this.vertexBuffer.getMappedRange()).set(quadVertices);
        this.vertexBuffer.unmap();
        
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
                    arrayStride: 2 * 4, // 2 floats, 4 bytes each
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
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
            primitive: { topology: 'triangle-strip' },
        });

        return true;
    }

    private updateCamera() {
        const fieldOfView = 60 * Math.PI / 180; // 60 degrees
        const aspect = GAME_WIDTH / GAME_HEIGHT;
        const zNear = 1;
        const zFar = 2000;
        mat4.perspective(this.projectionMatrix, fieldOfView, aspect, zNear, zFar);

        const eye = vec3.fromValues(
            GAME_WIDTH / 2,
            GAME_HEIGHT + 150, // Position camera "below" the board
            -700 // and pull it back
        );
        const center = vec3.fromValues(
            GAME_WIDTH / 2,
            GAME_HEIGHT / 2 - 50, // Look slightly "up" from the center
            0
        );
        const up = vec3.fromValues(0, -1, 0); // Y-down
        
        mat4.lookAt(this.viewMatrix, eye, center, up);

        mat4.multiply(this.viewProjectionMatrix, this.projectionMatrix, this.viewMatrix);
    }

    render(gameObjects: GameObjects): void {
        if (!this.device) return;

        this.updateCamera();
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.viewProjectionMatrix as Float32Array);

        let instanceCount = 0;
        const addInstance = (obj: GameObject, color: number[]) => {
            if (instanceCount >= MAX_INSTANCES) return;
            const offset = instanceCount * (INSTANCE_BYTE_SIZE / 4);
            // Center position
            this.instanceData[offset + 0] = obj.position.x + obj.size.width / 2;
            this.instanceData[offset + 1] = obj.position.y + obj.size.height / 2;
            // Size
            this.instanceData[offset + 2] = obj.size.width;
            this.instanceData[offset + 3] = obj.size.height;
            // Color
            this.instanceData[offset + 4] = color[0];
            this.instanceData[offset + 5] = color[1];
            this.instanceData[offset + 6] = color[2];
            this.instanceData[offset + 7] = color[3];
            instanceCount++;
        };

        addInstance(gameObjects.player, playerColor);
        gameObjects.invaders.forEach(inv => addInstance(inv, invaderColors[inv.type % invaderColors.length]));
        gameObjects.playerLasers.forEach(laser => addInstance(laser, playerLaserColor));
        gameObjects.invaderLasers.forEach(laser => addInstance(laser, invaderLaserColor));
        gameObjects.particles.forEach(p => {
            const alpha = Math.max(0, p.life * 2); // Fade out in the last 0.5s
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
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.uniformBindGroup);
        passEncoder.setVertexBuffer(0, this.vertexBuffer);
        passEncoder.draw(4, instanceCount, 0, 0);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }
}
