// FIX: The triple-slash directive below provides TypeScript with WebGPU type definitions, resolving errors about missing types like GPUDevice, GPUBuffer, etc.
/// <reference types="@webgpu/types" />

import type { Player, Invader, Laser, Particle, GameObject } from './types';
import { ModelType } from './types';
import { GAME_WIDTH, GAME_HEIGHT } from './constants';
import { mat4, vec3 } from 'gl-matrix';
import {
    cubeVertices, cubeIndices, cubeVsCode, cubeFsCode,
    playerShipVsCode, playerShipFsCode,
    invaderVertices, invaderIndices, invaderShader,
    laserVertices, laserIndices, laserVsCode, laserFsCode
} from './models';
import { createFlameSystem, flameShader } from './models/flames';
import { load } from '@loaders.gl/core';
import { GLTFLoader } from '@loaders.gl/gltf';

const MAX_INSTANCES = 5096;
const INSTANCE_BYTE_SIZE = 64;

type Model = {
    vertices: Float32Array;
    indices: Uint16Array | Uint32Array;
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
const playerColor = [0, 255/255, 255/255, 1.0]; // This will be a fallback color
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
    private presentationFormat!: GPUTextureFormat;
    private depthTexture!: GPUTexture;

    private models!: Map<ModelType, Model>;
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

    private flameSystem!: {
        flameInstanceBuffer: GPUBuffer;
        updateFlames: (deltaTime: number, modelMatrix: mat4) => void;
        getActiveFlameCount: () => number;
    };

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

        this.models = new Map<ModelType, Model>();

        // --- Buffers ---
        this.uniformBuffer = this.device.createBuffer({
            size: 80, // mat4x4<f32> (64) + time f32 (4) + padding (12)
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

        // --- Load Player Ship (Textured Model) ---
        try {
            const gltf = await load('models/playerShip/scene.gltf', GLTFLoader);
            const primitive = gltf.json.meshes[0].primitives[0];

            const getAccessorData = (gltf: any, accessorIndex: any) => {
                const accessor = gltf.json.accessors[accessorIndex];
                const bufferView = gltf.json.bufferViews[accessor.bufferView];
                const buffer = gltf.buffers[bufferView.buffer];
                let TypedArray;
                switch (accessor.componentType) {
                    case 5126: TypedArray = Float32Array; break; // FLOAT
                    case 5123: TypedArray = Uint16Array; break; // UNSIGNED_SHORT
                    case 5125: TypedArray = Uint32Array; break; // UNSIGNED_INT
                    default: throw new Error(`Unsupported component type: ${accessor.componentType}`);
                }
                const getNumComponents = (type: string) => {
                    switch (type) {
                        case 'SCALAR': return 1; case 'VEC2': return 2; case 'VEC3': return 3; case 'VEC4': return 4;
                        default: return 1;
                    }
                };
                const numComponents = getNumComponents(accessor.type);
                const numElements = accessor.count * numComponents;
                const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
                return new TypedArray(buffer.arrayBuffer, buffer.byteOffset + byteOffset, numElements);
            };

            const positions = getAccessorData(gltf, primitive.attributes.POSITION);
            const normals = getAccessorData(gltf, primitive.attributes.NORMAL);
            const uvs = getAccessorData(gltf, primitive.attributes.TEXCOORD_0);
            const indices = getAccessorData(gltf, primitive.indices);

            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            for (let i = 0; i < positions.length; i += 3) {
                const x = positions[i], y = positions[i + 1], z = positions[i + 2];
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
            }
            const modelWidth = maxX - minX, modelHeight = maxY - minY, modelDepth = maxZ - minZ;
            const centerX = minX + modelWidth / 2, centerY = minY + modelHeight / 2, centerZ = minZ + modelDepth / 2;
            const maxDim = Math.max(modelWidth, modelHeight, modelDepth);
            const scaleFactor = 1.0 / maxDim;
            const vertexCount = positions.length / 3;
            const combinedVertices = new Float32Array(vertexCount * 8);
            for (let i = 0; i < vertexCount; i++) {
                const p_offset = i * 3, v_offset = i * 8;
                combinedVertices[v_offset + 0] = (positions[p_offset + 0] - centerX) * scaleFactor;
                combinedVertices[v_offset + 1] = (positions[p_offset + 1] - centerY) * scaleFactor;
                combinedVertices[v_offset + 2] = (positions[p_offset + 2] - centerZ) * scaleFactor;
                const n_offset = i * 3;
                combinedVertices[v_offset + 3] = normals[n_offset + 0];
                combinedVertices[v_offset + 4] = normals[n_offset + 1];
                combinedVertices[v_offset + 5] = normals[n_offset + 2];
                const uv_offset = i * 2;
                combinedVertices[v_offset + 6] = uvs[uv_offset + 0];
                combinedVertices[v_offset + 7] = uvs[uv_offset + 1];
            }

            const vertexBuffer = this.device.createBuffer({ size: combinedVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
            new Float32Array(vertexBuffer.getMappedRange()).set(combinedVertices);
            vertexBuffer.unmap();
            const indexBuffer = this.device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
            new Uint16Array(indexBuffer.getMappedRange()).set(indices);
            indexBuffer.unmap();
            this.models.set(ModelType.PlayerShip, { vertices: combinedVertices, indices, vertexBuffer, indexBuffer });

            const material = gltf.json.materials[primitive.material];
            const pbrInfo = material.pbrMetallicRoughness;
            const loadTexture = (textureInfo: any) => {
                const image = gltf.images[gltf.json.textures[textureInfo.index].source];
                if (!image) { throw new Error("Could not find texture image."); }
                const gpuTexture = this.device.createTexture({ size: [image.width, image.height, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
                this.device.queue.copyExternalImageToTexture({ source: image }, { texture: gpuTexture }, [image.width, image.height]);
                return gpuTexture;
            };
            const baseColorTexture = loadTexture(pbrInfo.baseColorTexture);
            const metallicRoughnessTexture = loadTexture(pbrInfo.metallicRoughnessTexture);
            const sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

            const texturedBindGroupLayout = this.device.createBindGroupLayout({ entries: [ { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} } ] });
            this.playerShipBindGroup = this.device.createBindGroup({ layout: texturedBindGroupLayout, entries: [ { binding: 0, resource: { buffer: this.uniformBuffer } }, { binding: 1, resource: { buffer: this.instanceBuffer } }, { binding: 2, resource: sampler }, { binding: 3, resource: baseColorTexture.createView() }, { binding: 4, resource: metallicRoughnessTexture.createView() } ] });
            const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [texturedBindGroupLayout] });
            this.playerShipPipeline = this.device.createRenderPipeline({ layout: pipelineLayout, vertex: { module: this.device.createShaderModule({ code: playerShipVsCode }), entryPoint: 'main', buffers: [{ arrayStride: 8 * 4, attributes: [ { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' }, { shaderLocation: 2, offset: 6 * 4, format: 'float32x2' } ] }] }, fragment: { module: this.device.createShaderModule({ code: playerShipFsCode }), entryPoint: 'main', targets: [{ format: this.presentationFormat, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: {}} }] }, primitive: { topology: 'triangle-list' }, depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' } });
        } catch (error) {
            console.error("Failed to load and set up player ship model", error);
            return false;
        }

        // --- Load Other Models ---
        const modelData = [
            { type: ModelType.Cube, vertices: cubeVertices, indices: cubeIndices },
            { type: ModelType.Invader, vertices: invaderVertices, indices: invaderIndices },
            { type: ModelType.Laser, vertices: laserVertices, indices: laserIndices },
        ];
        for (const data of modelData) {
            const vertexBuffer = this.device.createBuffer({ size: data.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
            new Float32Array(vertexBuffer.getMappedRange()).set(data.vertices);
            vertexBuffer.unmap();
            const indexBuffer = this.device.createBuffer({ size: data.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
            const indexArray = data.indices instanceof Uint16Array ? new Uint16Array(indexBuffer.getMappedRange()) : new Uint32Array(indexBuffer.getMappedRange());
            indexArray.set(data.indices);
            indexBuffer.unmap();
            this.models.set(data.type, { vertices: data.vertices, indices: data.indices, vertexBuffer, indexBuffer });
        }

        // --- Create Pipelines & Bind Group for Non-Player Models ---
        const nonTexturedBindGroupLayout = this.device.createBindGroupLayout({ entries: [ { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } } ] });
        this.nonTexturedBindGroup = this.device.createBindGroup({ layout: nonTexturedBindGroupLayout, entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }, { binding: 1, resource: { buffer: this.instanceBuffer } }] });
        const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [nonTexturedBindGroupLayout] });
        
        const defaultBlend: GPUBlendState = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
        const additiveBlend: GPUBlendState = { color: { srcFactor: 'src-alpha', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };

        // Invader Pipeline
        this.invaderPipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: { module: this.device.createShaderModule({ code: invaderShader }), entryPoint: 'vs_main', buffers: [{ arrayStride: 8 * 4, attributes: [ { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' }, { shaderLocation: 2, offset: 6 * 4, format: 'float32x2' } ] }] },
            fragment: { module: this.device.createShaderModule({ code: invaderShader }), entryPoint: 'fs_main', targets: [{ format: this.presentationFormat, blend: defaultBlend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
        });

        // Laser Pipeline
        this.laserPipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: { module: this.device.createShaderModule({ code: laserVsCode }), entryPoint: 'main', buffers: [{ arrayStride: 6 * 4, attributes: [ { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' } ] }] },
            fragment: { module: this.device.createShaderModule({ code: laserFsCode }), entryPoint: 'main', targets: [{ format: this.presentationFormat, blend: defaultBlend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
        });

        // Particle Pipeline
        this.particlePipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: { module: this.device.createShaderModule({ code: cubeVsCode }), entryPoint: 'main', buffers: [{ arrayStride: 6 * 4, attributes: [ { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' } ] }] },
            fragment: { module: this.device.createShaderModule({ code: cubeFsCode }), entryPoint: 'main', targets: [{ format: this.presentationFormat, blend: additiveBlend }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
        });

        // --- Flame System ---
        this.flameSystem = createFlameSystem(this.device);
        const flameBindGroupLayout = this.device.createBindGroupLayout({ entries: [ { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } } ] });
        this.flameBindGroup = this.device.createBindGroup({ layout: flameBindGroupLayout, entries: [{ binding: 1, resource: { buffer: this.flameUniformBuffer } }] });
        const flamePipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [flameBindGroupLayout] });
                this.flamePipeline = this.device.createRenderPipeline({
            layout: flamePipelineLayout,
            vertex: {
                module: this.device.createShaderModule({ code: flameShader }),
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
                module: this.device.createShaderModule({ code: flameShader }),
                entryPoint: 'fs_main',
                targets: [{ format: this.presentationFormat, blend: additiveBlend }],
            },
            primitive: { topology: 'triangle-list' },
            depthStencil: { depthWriteEnabled: false, depthCompare: 'less', format: 'depth24plus' },
        });

        return true;
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
        const nativeAspect = 800 / 600;

        // Define the base vertical FOV, which we want to maintain in landscape.
        const baseVerticalFov = 60 * (Math.PI / 180);
        let verticalFov = baseVerticalFov;

        // If the screen is narrower than the game's native aspect ratio (e.g., portrait mode)
        if (aspect < nativeAspect) {
            // We are constrained by width. We need to adjust the vertical FOV
            // to ensure the horizontal FOV remains constant and shows the whole game world.
            // First, calculate the horizontal FOV that corresponds to our base vertical FOV at the native aspect ratio.
            const baseHorizontalFov = 2 * Math.atan(Math.tan(baseVerticalFov / 2) * nativeAspect);
            
            // Now, calculate the new vertical FOV that will produce our desired baseHorizontalFov with the new, narrower aspect ratio.
            verticalFov = 2 * Math.atan(Math.tan(baseHorizontalFov / 2) / aspect);
        }
        // Else (for landscape modes), we just use the baseVerticalFov, and the view will be letterboxed.

        mat4.perspective(this.projectionMatrix, verticalFov, aspect, 1, 2000);
    }

    render(gameObjects: GameObjects, cameraYOffset: number, deltaTime: number): void {
        if (!this.device || !this.models) return;

        this.updateCamera(cameraYOffset);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.viewProjectionMatrix as Float32Array);
        this.device.queue.writeBuffer(this.uniformBuffer, 64, new Float32Array([performance.now() / 1000]));
        this.device.queue.writeBuffer(this.flameUniformBuffer, 0, this.viewProjectionMatrix as Float32Array);
        this.device.queue.writeBuffer(this.flameUniformBuffer, 64, this.viewMatrix as Float32Array);

        const playerModelMatrix = mat4.create();
        mat4.translate(playerModelMatrix, playerModelMatrix, [gameObjects.player.position.x + gameObjects.player.size.width / 2, gameObjects.player.position.y + gameObjects.player.size.height / 2, gameObjects.player.position.z]);
        mat4.scale(playerModelMatrix, playerModelMatrix, [gameObjects.player.size.width, gameObjects.player.size.height, gameObjects.player.size.depth]);

        this.flameSystem.updateFlames(deltaTime, playerModelMatrix);

        const objectsByModel = new Map<ModelType, GameObject[]>();
        const allObjects = [ gameObjects.player, ...gameObjects.invaders, ...gameObjects.playerLasers, ...gameObjects.invaderLasers, ...gameObjects.particles ];
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

        let drawnInstances = 0;
        for (const [modelType, objects] of objectsByModel.entries()) {
            if (objects.length === 0) continue;
            const model = this.models.get(modelType)!;

            let pipeline: GPURenderPipeline;
            let bindGroup = this.nonTexturedBindGroup;
            let indexFormat: GPUIndexFormat = 'uint16';

            switch (modelType) {
                case ModelType.PlayerShip:
                    pipeline = this.playerShipPipeline;
                    bindGroup = this.playerShipBindGroup;
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