// Note: This file now contains the geometry for a sphere (icosphere),
// but retains the name 'cube.ts' to avoid breaking imports.
// It is used by the particle system.

const s = 0.5 / Math.sqrt(1.0*1.0 + ((1.0 + Math.sqrt(5.0)) / 2.0)*((1.0 + Math.sqrt(5.0)) / 2.0));
const t = ((1.0 + Math.sqrt(5.0)) / 2.0) * s;

// The 12 vertices of a icosahedron, scaled to a radius of 0.5
const v = [
    [-s, t, 0], [s, t, 0], [-s, -t, 0], [s, -t, 0],
    [0, -s, t], [0, s, t], [0, -s, -t], [0, s, -t],
    [t, 0, -s], [t, 0, s], [-t, 0, -s], [-t, 0, s]
];

const verts = [];
for (let i = 0; i < v.length; i++) {
    const pos = v[i];
    const len = Math.sqrt(pos[0]*pos[0] + pos[1]*pos[1] + pos[2]*pos[2]);
    const norm = [pos[0]/len, pos[1]/len, pos[2]/len];
    verts.push(...pos, ...norm);
}

export const cubeVertices = new Float32Array(verts);

export const cubeIndices = new Uint16Array([
    0, 11, 5,  0, 5, 1,  0, 1, 7,  0, 7, 10,  0, 10, 11,
    1, 5, 9,  5, 11, 4,  11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4,  3, 4, 2,  3, 2, 6,  3, 6, 8,  3, 8, 9,
    4, 9, 5,  2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1
]);

export const cubeVsCode = `
struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) age: f32,
};

struct InstanceInput {
    model_pos: vec3<f32>,
    model_size: vec3<f32>,
    color: vec4<f32>,
    life: f32,
    initialLife: f32,
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
    
    var age = 0.0;
    if (instance.initialLife > 0.0) {
        age = 1.0 - (instance.life / instance.initialLife);
    }

    var size = instance.model_size;
    if (instance.initialLife > 0.0) {
        size = instance.model_size * (1.0 - age);
    }

    let world_pos = vec4<f32>(
        (vert.position * size) + instance.model_pos,
        1.0
    );
    
    var out: VertexOutput;
    out.position = globals.view_proj * world_pos;
    out.color = instance.color;
    out.normal = vert.normal;
    out.age = age;
    return out;
}
`;

export const cubeFsCode = `
@fragment
fn main(
    @location(0) color: vec4<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) age: f32
) -> @location(0) vec4<f32> {

    var output_color = color;

    // If age > 0, it's a particle (emissive object).
    if (age > 0.0) {
        let orange = vec4<f32>(1.0, 0.5, 0.0, 1.0);
        let alpha = 1.0 - age;
        output_color = vec4<f32>(orange.rgb, alpha);
        return output_color; // Return the pure, unlit color
    }

    // Otherwise, it's a regular cube, so apply lighting.
    let light_direction = normalize(vec3<f32>(0.3, 0.6, 0.7));
    let diffuse_strength = max(dot(normal, light_direction), 0.25);
    let final_lit_color = output_color.rgb * diffuse_strength;
    return vec4<f32>(final_lit_color, output_color.a);
}
`;
