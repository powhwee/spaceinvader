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