export const playerShipVertices = new Float32Array([
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

export const playerShipIndices = new Uint16Array([
    0, 1, 2, 0, 2, 3, // -z
    4, 5, 6, 4, 6, 7, // +z
    8, 9, 10, 8, 10, 11, // -x
    12, 13, 14, 12, 14, 15, // +x
    16, 17, 18, 16, 18, 19, // -y
    20, 21, 22, 20, 22, 23, // +y
]);

export const playerShipVsCode = `
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
    
    let world_pos = vec4<f32>(
        (vert.position * instance.model_size) + instance.model_pos,
        1.0
    );
    
    var out: VertexOutput;
    out.position = globals.view_proj * world_pos;
    out.color = instance.color;
    out.normal = vert.normal;
    out.age = 0.0; // Not a particle, so age is 0
    return out;
}
`;

export const playerShipFsCode = `
@fragment
fn main(
    @location(0) color: vec4<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) age: f32
) -> @location(0) vec4<f32> {
    let light_direction = normalize(vec3<f32>(0.3, 0.6, 0.7));
    let diffuse_strength = max(dot(normal, light_direction), 0.25);
    let final_color = color.rgb * diffuse_strength;
    return vec4<f32>(final_color, color.a);
}
`;
