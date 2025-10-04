export const playerShipVsCode = `
struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) age: f32,
    @location(3) uv: vec2<f32>,
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
    out.uv = vert.uv;
    return out;
}
`;

export const playerShipFsCode = `
@group(0) @binding(2) var mySampler: sampler;
@group(0) @binding(3) var myTexture: texture_2d<f32>;

@fragment
fn main(
    @location(1) normal: vec3<f32>,
    @location(3) uv: vec2<f32>
) -> @location(0) vec4<f32> {
    let texColor = textureSample(myTexture, mySampler, uv);
    let light_direction = normalize(vec3<f32>(0.3, 0.6, 0.7));
    let diffuse_strength = max(dot(normal, light_direction), 0.25);
    let final_color = texColor.rgb * diffuse_strength;
    return vec4<f32>(final_color, texColor.a);
}
`;
