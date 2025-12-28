import { load } from '@loaders.gl/core';
import { GLTFLoader } from '@loaders.gl/gltf';
import { ModelType } from './types';
import { mat4, vec3, quat } from 'gl-matrix';

export type Model = {
    vertices: Float32Array;
    indices: Uint16Array | Uint32Array;
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
};

export class ResourceManager {
    private device: GPUDevice;
    public models = new Map<ModelType, Model>();
    public shaders = new Map<string, string>();
    public textures = new Map<string, GPUTexture>();
    public sampler!: GPUSampler;

    constructor(device: GPUDevice) {
        this.device = device;
    }

    public async loadShader(name: string, url: string) {
        const response = await fetch(url);
        const text = await response.text();
        this.shaders.set(name, text);
    }

    public async loadModel(type: ModelType, vertices: Float32Array, indices: Uint16Array | Uint32Array) {
        const vertexBuffer = this.device.createBuffer({
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(vertexBuffer.getMappedRange()).set(vertices);
        vertexBuffer.unmap();

        const indexBuffer = this.device.createBuffer({
            size: indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        const indexArray = indices instanceof Uint16Array ? new Uint16Array(indexBuffer.getMappedRange()) : new Uint32Array(indexBuffer.getMappedRange());
        indexArray.set(indices);
        indexBuffer.unmap();

        this.models.set(type, { vertices, indices, vertexBuffer, indexBuffer });
    }

    public async loadGltfModel(type: ModelType, url: string) {
        const gltf = await load(url, GLTFLoader);

        const getAccessorData = (accessorIndex: any) => {
            const accessor = gltf.json.accessors[accessorIndex];
            const bufferView = gltf.json.bufferViews[accessor.bufferView];
            const buffer = gltf.buffers[bufferView.buffer];
            let TypedArray;
            switch (accessor.componentType) {
                case 5126: TypedArray = Float32Array; break;
                case 5123: TypedArray = Uint16Array; break;
                case 5125: TypedArray = Uint32Array; break;
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

        const primitive = gltf.json.meshes[0].primitives[0];
        const positions = getAccessorData(primitive.attributes.POSITION);
        const normals = getAccessorData(primitive.attributes.NORMAL);
        const uvs = getAccessorData(primitive.attributes.TEXCOORD_0);
        const indices = getAccessorData(primitive.indices);

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
            const p_offset = i * 3;
            const v_offset = i * 8;
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

        await this.loadModel(type, combinedVertices, indices);

        const material = gltf.json.materials[gltf.json.meshes[0].primitives[0].material];
        const pbrInfo = material.pbrMetallicRoughness;

        const loadTexture = async (name: string, textureInfo: any) => {
            const image = gltf.images[gltf.json.textures[textureInfo.index].source];
            if (!image) { throw new Error(`Could not find texture image for ${name}.`); }
            const gpuTexture = this.device.createTexture({ size: [image.width, image.height, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
            this.device.queue.copyExternalImageToTexture({ source: image }, { texture: gpuTexture }, [image.width, image.height]);
            this.textures.set(name, gpuTexture);
        };

        if (pbrInfo.baseColorTexture) {
            await loadTexture('baseColor', pbrInfo.baseColorTexture);
        }
        if (pbrInfo.metallicRoughnessTexture) {
            await loadTexture('metallicRoughness', pbrInfo.metallicRoughnessTexture);
        }

        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    }

    public async loadTexture(name: string, url: string) {
        const response = await fetch(url);
        const blob = await response.blob();
        const image = await createImageBitmap(blob);

        const texture = this.device.createTexture({
            size: [image.width, image.height, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
        });

        this.device.queue.copyExternalImageToTexture(
            { source: image },
            { texture: texture },
            [image.width, image.height]
        );

        this.textures.set(name, texture);
    }
}