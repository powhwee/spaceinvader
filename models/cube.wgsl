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
    time: f32,
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> instances: array<InstanceInput>;

@vertex
fn vs_main(
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

@fragment
fn fs_main(
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
