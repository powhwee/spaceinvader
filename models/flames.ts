import { vec3, mat4 } from 'gl-matrix';

export const MAX_FLAMES = 1000;

interface Flame {
    active: boolean;
    lifetime: number;
    lifeRemaining: number;
    position: vec3;
    velocity: vec3;
    size: number;
}

export function createFlameSystem(device: GPUDevice): {
    flameInstanceBuffer: GPUBuffer;
    updateFlames: (deltaTime: number, modelMatrix: mat4) => void;
    getActiveFlameCount: () => number;
} {
    const flames: Flame[] = Array.from({ length: MAX_FLAMES }, () => ({
        active: false,
        lifetime: 0,
        lifeRemaining: 0,
        position: vec3.create(),
        velocity: vec3.create(),
        size: 0,
    }));
    const flameInstanceData = new Float32Array(MAX_FLAMES * 8); // pos(3), size(1), color(4)
    const flameInstanceBuffer = device.createBuffer({
        size: flameInstanceData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    let activeFlameCount = 0;

    function updateFlames(deltaTime: number, modelMatrix: mat4) {
        const emitRate = 10;
        for (let i = 0; i < emitRate; i++) {
            const p = flames.find(p => !p.active);
            if (!p) continue;

            p.active = true;
            p.lifetime = Math.random() * 0.8 + 0.2;
            p.lifeRemaining = p.lifetime;

            const enginePos: vec3 = [0, -0.5, 0];
            vec3.transformMat4(p.position, enginePos, modelMatrix);

                        const localVelocity: vec3 = [
                (Math.random() - 0.5) * 32,
                -84 - Math.random() * 56,
                (Math.random() - 0.5) * 32,
            ];

            const rotationMatrix = mat4.clone(modelMatrix);
            rotationMatrix[12] = 0; // Zero out translation components
            rotationMatrix[13] = 0;
            rotationMatrix[14] = 0;

            // Remove scaling from the matrix, so velocity isn't affected by model scale
            const scaling = vec3.create();
            mat4.getScaling(scaling, rotationMatrix);
            if (scaling[0] !== 0 && scaling[1] !== 0 && scaling[2] !== 0) {
                const invScale = vec3.inverse(vec3.create(), scaling);
                mat4.scale(rotationMatrix, rotationMatrix, invScale);
            }

            vec3.transformMat4(p.velocity, localVelocity, rotationMatrix);
            p.size = Math.random() * 15 + 7.5; // Increased size for debugging
        }

        activeFlameCount = 0;
        for (const p of flames) {
            if (!p.active) continue;

            p.lifeRemaining -= deltaTime;
            if (p.lifeRemaining <= 0) {
                p.active = false;
                continue;
            }

            vec3.scaleAndAdd(p.position, p.position, p.velocity, deltaTime);
            const lifeRatio = p.lifeRemaining / p.lifetime;

            const offset = activeFlameCount * 8;
            flameInstanceData.set(p.position, offset);
            flameInstanceData[offset + 3] = p.size * lifeRatio;
            flameInstanceData[offset + 4] = 1.0;
            flameInstanceData[offset + 5] = lifeRatio * 0.8;
            flameInstanceData[offset + 6] = 0.0;
            flameInstanceData[offset + 7] = lifeRatio * 0.7;

            activeFlameCount++;
        }

        if (activeFlameCount > 0) {
            device.queue.writeBuffer(flameInstanceBuffer, 0, flameInstanceData, 0, activeFlameCount * 8);
        }
    }

    return { flameInstanceBuffer, updateFlames, getActiveFlameCount: () => activeFlameCount };
}

export const flameShader: string = `
    struct Uniforms { vpMatrix: mat4x4<f32>, vMatrix: mat4x4<f32> };
    @group(0) @binding(1) var<uniform> uniforms: Uniforms;
    struct VSOutput { @builtin(position) pos: vec4<f32>, @location(0) color: vec4<f32>, @location(1) uv: vec2<f32> };

    const quad_pos = array<vec2<f32>, 4>(vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(-0.5, 0.5), vec2(0.5, 0.5));
    const quad_uv = array<vec2<f32>, 4>(vec2(0.0, 1.0), vec2(1.0, 1.0), vec2(0.0, 0.0), vec2(1.0, 0.0));
        const quad_indices = array<u32, 6>(0, 1, 2, 1, 3, 2);

    @vertex
    fn vs_main(@builtin(vertex_index) v_idx: u32, @location(0) inst_pos: vec3<f32>, @location(1) inst_size: f32, @location(2) inst_color: vec4<f32>) -> VSOutput {
        var out: VSOutput;
        let corner_idx = quad_indices[v_idx];
        
        // Billboard calculation: make quad face the camera
        let right = vec4<f32>(uniforms.vMatrix[0][0], uniforms.vMatrix[1][0], uniforms.vMatrix[2][0], 0.0) * quad_pos[corner_idx].x;
        let up = vec4<f32>(uniforms.vMatrix[0][1], uniforms.vMatrix[1][1], uniforms.vMatrix[2][1], 0.0) * quad_pos[corner_idx].y;
        let final_pos = vec4<f32>(inst_pos, 1.0) + (right + up) * inst_size;
        
        out.pos = uniforms.vpMatrix * final_pos;
        out.color = inst_color;
        out.uv = quad_uv[corner_idx];
        return out;
    }

    @fragment
    fn fs_main(in: VSOutput) -> @location(0) vec4<f32> {
        let dist = distance(in.uv, vec2(0.5, 0.5));
        let alpha = 1.0 - smoothstep(0.4, 0.5, dist);
        return vec4(in.color.rgb, in.color.a * alpha);
    }
`;