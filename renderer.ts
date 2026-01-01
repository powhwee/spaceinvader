/// <reference types="@webgpu/types" />

import playerShipWGSL from './models/playerShip.wgsl?raw';
import invaderWGSL from './models/invader.wgsl?raw';
import laserWGSL from './models/laser.wgsl?raw';
import cubeWGSL from './models/cube.wgsl?raw';
import flameWGSL from './models/flame.wgsl?raw';
import backgroundWGSL from './models/background.wgsl?raw';

import type { Player, Invader, Laser, Particle, GameObject } from './types';
import { ModelType } from './types';
import { GAME_WIDTH, GAME_HEIGHT } from './constants';
import { mat4, vec3 } from 'gl-matrix';
import {
    cubeVertices, cubeIndices,
    invaderVertices, invaderIndices,
    laserVertices, laserIndices
} from './models';
import { createFlameSystem } from './models/flames';
import { ResourceManager, Model } from './ResourceManager';

const MAX_INSTANCES = 5096;
const INSTANCE_BYTE_SIZE = 64;

const invaderColors = [
    [236 / 255, 72 / 255, 153 / 255, 1.0],  // Pink
    [168 / 255, 85 / 255, 247 / 255, 1.0],   // Purple
    [250 / 255, 204 / 255, 21 / 255, 1.0],   // Yellow
    [34 / 255, 197 / 255, 94 / 255, 1.0],    // Green
    [249 / 255, 115 / 255, 22 / 255, 1.0],   // Orange
];
const playerColor = [0, 255 / 255, 255 / 255, 1.0]; // This will be a fallback color
const playerLaserColor = [52 / 255, 211 / 255, 153 / 255, 1.0];
const invaderLaserColor = [239 / 255, 68 / 255, 68 / 255, 1.0];

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
    private presentationFormat!: GPUTextureFormat;
    private depthTexture!: GPUTexture;

    private resourceManager!: ResourceManager;
    private uniformBuffer!: GPUBuffer;
    private flameUniformBuffer!: GPUBuffer;
    private instanceBuffer!: GPUBuffer;
    private instanceData: Float32Array;

    //Pipelines and Bind Groups
    private invaderPipeline!: GPURenderPipeline;
    private laserPipeline!: GPURenderPipeline;
    private particlePipeline!: GPURenderPipeline;
    private playerShipPipeline!: GPURenderPipeline;
    private nonTexturedBindGroup!: GPUBindGroup;
    private playerShipBindGroup!: GPUBindGroup;
    private flamePipeline!: GPURenderPipeline;
    private flameBindGroup!: GPUBindGroup;

    private backgroundPipeline!: GPURenderPipeline;
    private backgroundBindGroup!: GPUBindGroup;

    private flameSystem!: {
        flameInstanceBuffer: GPUBuffer;
        updateFlames: (deltaTime: number, modelMatrix: mat4) => void;
        getActiveFlameCount: () => number;
    };

    private projectionMatrix: mat4;
    private viewMatrix: mat4;
    private viewProjectionMatrix: mat4;
    private verticalFov: number = 60 * (Math.PI / 180);

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

        this.resourceManager = new ResourceManager(this.device);

        // --- Buffers ---
        this.uniformBuffer = this.device.createBuffer({
            size: 80, // mat4x4<f32> (64) + time(4) + aspect(4) + fov(4) = 76 -> 80 aligned
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.flameUniformBuffer = this.device.createBuffer({
            size: 128, // 2 * mat4x4<f32>
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.instanceBuffer = this.device.createBuffer({
            size: MAX_INSTANCES * INSTANCE_BYTE_SIZE,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        // --- Load Assets ---
        await this.resourceManager.loadGltfModel(ModelType.PlayerShip, 'models/playerShip/scene.gltf');
        await this.resourceManager.loadModel(ModelType.Cube, cubeVertices, cubeIndices);
        await this.resourceManager.loadModel(ModelType.Invader, invaderVertices, invaderIndices);
        await this.resourceManager.loadModel(ModelType.Laser, laserVertices, laserIndices);
        await this.resourceManager.loadTexture('jupiter', 'assets/jupiter.png');

        this.resourceManager.shaders.set('playerShip', playerShipWGSL);
        this.resourceManager.shaders.set('invader', invaderWGSL);
        this.resourceManager.shaders.set('laser', laserWGSL);
        this.resourceManager.shaders.set('cube', cubeWGSL);
        this.resourceManager.shaders.set('flame', flameWGSL);
        this.resourceManager.shaders.set('background', backgroundWGSL);

        // --- Create Pipelines & Bind Groups ---
        this._createPlayerShipPipeline();
        this._createNonTexturedPipelines();
        this._createFlamePipeline();
        this._createBackgroundPipeline();

        // Ensure depth texture and viewport are initialized
        this.resize(this.canvas.clientWidth, this.canvas.clientHeight);

        return true;
    }

    private _createBackgroundPipeline() {
        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} }
            ]
        });

        this.backgroundBindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: this.resourceManager.sampler },
                { binding: 2, resource: this.resourceManager.textures.get('jupiter')!.createView() }
            ]
        });

        const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

        this.backgroundPipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: this.device.createShaderModule({ code: this.resourceManager.shaders.get('background')! }),
                entryPoint: 'vs_main',
            },
            fragment: {
                module: this.device.createShaderModule({ code: this.resourceManager.shaders.get('background')! }),
                entryPoint: 'fs_main',
                targets: [{ format: this.presentationFormat }],
            },
            primitive: { topology: 'triangle-list' },
            depthStencil: {
                depthWriteEnabled: false,
                depthCompare: 'always',
                format: 'depth24plus',
            }
        });
    }

    private _createPlayerShipPipeline() {
        const texturedBindGroupLayout = this.device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} }] });
        this.playerShipBindGroup = this.device.createBindGroup({ layout: texturedBindGroupLayout, entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }, { binding: 1, resource: { buffer: this.instanceBuffer } }, { binding: 2, resource: this.resourceManager.sampler }, { binding: 3, resource: this.resourceManager.textures.get('baseColor')!.createView() }, { binding: 4, resource: this.resourceManager.textures.get('metallicRoughness')!.createView() }] });
        const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [texturedBindGroupLayout] });
        this.playerShipPipeline = this.device.createRenderPipeline({ layout: pipelineLayout, vertex: { module: this.device.createShaderModule({ code: this.resourceManager.shaders.get('playerShip')! }), entryPoint: 'vs_main', buffers: [{ arrayStride: 8 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' }, { shaderLocation: 2, offset: 6 * 4, format: 'float32x2' }] }] }, fragment: { module: this.device.createShaderModule({ code: this.resourceManager.shaders.get('playerShip')! }), entryPoint: 'fs_main', targets: [{ format: this.presentationFormat, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: {} } }] }, primitive: { topology: 'triangle-list' }, depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' } });
    }

    private _createNonTexturedPipelines() {
        const nonTexturedBindGroupLayout = this.device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }] });
        this.nonTexturedBindGroup = this.device.createBindGroup({ layout: nonTexturedBindGroupLayout, entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }, { binding: 1, resource: { buffer: this.instanceBuffer } }] });
        const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [nonTexturedBindGroupLayout] });

        const defaultBlend: GPUBlendState = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
        const additiveBlend: GPUBlendState = { color: { srcFactor: 'src-alpha', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };

        this.invaderPipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: { module: this.device.createShaderModule({ code: this.resourceManager.shaders.get('invader')! }), entryPoint: 'vs_main', buffers: [{ arrayStride: 8 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' }, { shaderLocation: 2, offset: 6 * 4, format: 'float32x2' }] }] },
            fragment: { module: this.device.createShaderModule({ code: this.resourceManager.shaders.get('invader')! }), entryPoint: 'fs_main', targets: [{ format: this.presentationFormat, blend: defaultBlend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
        });

        this.laserPipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: { module: this.device.createShaderModule({ code: this.resourceManager.shaders.get('laser')! }), entryPoint: 'vs_main', buffers: [{ arrayStride: 6 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' }] }] },
            fragment: { module: this.device.createShaderModule({ code: this.resourceManager.shaders.get('laser')! }), entryPoint: 'fs_main', targets: [{ format: this.presentationFormat, blend: defaultBlend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
        });

        this.particlePipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: { module: this.device.createShaderModule({ code: this.resourceManager.shaders.get('cube')! }), entryPoint: 'vs_main', buffers: [{ arrayStride: 6 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' }] }] },
            fragment: { module: this.device.createShaderModule({ code: this.resourceManager.shaders.get('cube')! }), entryPoint: 'fs_main', targets: [{ format: this.presentationFormat, blend: additiveBlend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
        });
    }

    private _createFlamePipeline() {
        this.flameSystem = createFlameSystem(this.device);
        const flameBindGroupLayout = this.device.createBindGroupLayout({ entries: [{ binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
        this.flameBindGroup = this.device.createBindGroup({ layout: flameBindGroupLayout, entries: [{ binding: 1, resource: { buffer: this.flameUniformBuffer } }] });
        const flamePipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [flameBindGroupLayout] });
        this.flamePipeline = this.device.createRenderPipeline({
            layout: flamePipelineLayout,
            vertex: {
                module: this.device.createShaderModule({ code: this.resourceManager.shaders.get('flame')! }),
                entryPoint: 'vs_main',
                buffers: [{
                    arrayStride: 8 * 4, // 3 pos, 1 size, 4 color
                    stepMode: 'instance',
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x3' }, // inst_pos
                        { shaderLocation: 1, offset: 3 * 4, format: 'float32' },   // inst_size
                        { shaderLocation: 2, offset: 4 * 4, format: 'float32x4' }, // inst_color
                    ],
                }],
            },
            fragment: {
                module: this.device.createShaderModule({ code: this.resourceManager.shaders.get('flame')! }),
                entryPoint: 'fs_main',
                targets: [{
                    format: this.presentationFormat,
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
                    }
                }],
            },
            primitive: { topology: 'triangle-list' },
            depthStencil: { depthWriteEnabled: false, depthCompare: 'less', format: 'depth24plus' },
        });
    }

    private updateCamera(cameraYOffset: number) {
        const cameraDistance = (GAME_WIDTH / 2) / Math.tan((60 * Math.PI / 180) / 2);
        const eye = vec3.fromValues(GAME_WIDTH / 2, 120 + cameraYOffset, cameraDistance);
        const center = vec3.fromValues(GAME_WIDTH / 2, 290, 0);
        mat4.lookAt(this.viewMatrix, eye, center, vec3.fromValues(0, 1, 0));
        mat4.multiply(this.viewProjectionMatrix, this.projectionMatrix, this.viewMatrix);
    }

    resize(width: number, height: number) {
        if (!this.device || (width === 0 || height === 0)) return;

        const devicePixelRatio = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(width * devicePixelRatio);
        this.canvas.height = Math.round(height * devicePixelRatio);

        if (this.depthTexture) {
            this.depthTexture.destroy();
        }

        this.depthTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        const aspect = width / height;

        // MOBILE ZOOM FEATURE:
        // In portrait mode (mostly mobile), the standard 800-width leaves game objects too small.
        // Since the gameplay happens in the center 650px (Invader Formation = 650px),
        // we can safely crop the 800px width down to ~660px to zoom in.
        // This gives a ~21% size boost to all objects.
        const isPortrait = width < height;
        const targetWidth = isPortrait ? 660 : 800;

        const nativeAspect = targetWidth / 600; // 600 is GAME_HEIGHT

        const baseVerticalFov = 60 * (Math.PI / 180);
        let verticalFov = baseVerticalFov;

        if (aspect < nativeAspect) {
            const baseHorizontalFov = 2 * Math.atan(Math.tan(baseVerticalFov / 2) * nativeAspect);
            verticalFov = 2 * Math.atan(Math.tan(baseHorizontalFov / 2) / aspect);
        }

        this.verticalFov = verticalFov;
        mat4.perspective(this.projectionMatrix, verticalFov, aspect, 1, 2000);
    }

    render(gameObjects: GameObjects, cameraYOffset: number, deltaTime: number): void {
        if (!this.device || !this.resourceManager) return;

        this.updateCamera(cameraYOffset);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.viewProjectionMatrix as Float32Array);
        this.device.queue.writeBuffer(this.uniformBuffer, 64, new Float32Array([performance.now() / 1000]));
        // Upload aspect ratio to offset 68 (after time + padding is not needed for loose floats in struct)
        // WGSL struct layout: view_proj(0-64), time(64-68), aspect_ratio(68-72), vertical_fov(72-76)
        const aspect = this.canvas.width / this.canvas.height;
        this.device.queue.writeBuffer(this.uniformBuffer, 68, new Float32Array([aspect]));
        this.device.queue.writeBuffer(this.uniformBuffer, 72, new Float32Array([this.verticalFov]));
        this.device.queue.writeBuffer(this.flameUniformBuffer, 0, this.viewProjectionMatrix as Float32Array);
        this.device.queue.writeBuffer(this.flameUniformBuffer, 64, this.viewMatrix as Float32Array);

        const playerModelMatrix = mat4.create();
        mat4.translate(playerModelMatrix, playerModelMatrix, [gameObjects.player.position.x + gameObjects.player.size.width / 2, gameObjects.player.position.y + gameObjects.player.size.height / 2, gameObjects.player.position.z]);
        mat4.scale(playerModelMatrix, playerModelMatrix, [gameObjects.player.size.width, gameObjects.player.size.height, gameObjects.player.size.depth]);

        this.flameSystem.updateFlames(deltaTime, playerModelMatrix);

        const objectsByModel = new Map<ModelType, GameObject[]>();
        const allObjects = [gameObjects.player, ...gameObjects.invaders, ...gameObjects.playerLasers, ...gameObjects.invaderLasers, ...gameObjects.particles];
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
                if (obj.modelType === ModelType.Cube && 'initialLife' in obj) {
                    color = (obj as Particle).color;
                } else if (obj.modelType === ModelType.PlayerShip) {
                    color = playerColor;
                } else if (obj.modelType === ModelType.Invader) {
                    color = invaderColors[(obj as Invader).type % invaderColors.length];
                } else if (obj.modelType === ModelType.Laser) {
                    color = gameObjects.playerLasers.some(l => l.id === obj.id) ? playerLaserColor : invaderLaserColor;
                } else {
                    color = [1, 1, 1, 1];
                }

                const worldY = obj.position.y + obj.size.height / 2;
                let float_offset = offset;
                this.instanceData.set([obj.position.x + obj.size.width / 2, worldY, obj.position.z + obj.size.depth / 2], float_offset); float_offset += 4;
                this.instanceData.set([obj.size.width, obj.size.height, obj.size.depth], float_offset); float_offset += 4;
                this.instanceData.set(color, float_offset); float_offset += 4;
                this.instanceData[float_offset++] = 'life' in obj ? (obj as Particle).life : 0.0;
                this.instanceData[float_offset++] = 'initialLife' in obj ? (obj as Particle).initialLife : 0.0;

                instanceCount++;
            }
        }
        this.device.queue.writeBuffer(this.instanceBuffer, 0, this.instanceData, 0, instanceCount * instanceFloatSize);

        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();
        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [{ view: textureView, clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1.0 }, loadOp: 'clear', storeOp: 'store' }],
            depthStencilAttachment: { view: this.depthTexture.createView(), depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store' },
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

        // --- Render Background ---
        if (this.backgroundPipeline) {
            passEncoder.setPipeline(this.backgroundPipeline);
            passEncoder.setBindGroup(0, this.backgroundBindGroup);
            passEncoder.draw(3, 1, 0, 0); // Draw full-screen triangle
        }

        let drawnInstances = 0;
        for (const [modelType, objects] of objectsByModel.entries()) {
            if (objects.length === 0) continue;
            const model = this.resourceManager.models.get(modelType)!;

            let pipeline: GPURenderPipeline;
            let bindGroup = this.nonTexturedBindGroup;
            let indexFormat: GPUIndexFormat = 'uint16';

            switch (modelType) {
                case ModelType.PlayerShip:
                    pipeline = this.playerShipPipeline;
                    bindGroup = this.playerShipBindGroup;
                    indexFormat = 'uint32';
                    break;
                case ModelType.Invader:
                    pipeline = this.invaderPipeline;
                    indexFormat = 'uint32';
                    break;
                case ModelType.Laser:
                    pipeline = this.laserPipeline;
                    break;
                case ModelType.Cube:
                    pipeline = this.particlePipeline;
                    break;
                default:
                    continue;
            }

            passEncoder.setPipeline(pipeline);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.setVertexBuffer(0, model.vertexBuffer);
            passEncoder.setIndexBuffer(model.indexBuffer, indexFormat);
            passEncoder.drawIndexed(model.indices.length, objects.length, 0, 0, drawnInstances);

            drawnInstances += objects.length;
        }

        const activeFlameCount = this.flameSystem.getActiveFlameCount();
        if (activeFlameCount > 0) {
            passEncoder.setPipeline(this.flamePipeline);
            passEncoder.setBindGroup(0, this.flameBindGroup);
            passEncoder.setVertexBuffer(0, this.flameSystem.flameInstanceBuffer);
            passEncoder.draw(6, activeFlameCount, 0, 0);
        }

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
