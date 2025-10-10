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

struct VSOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) color: vec4<f32>,
};

@vertex
fn vs_main(
    @builtin(instance_index) instance_index : u32,
    @location(0) pos: vec3<f32>, 
    @location(1) normal: vec3<f32>, 
    @location(2) uv: vec2<f32>
) -> VSOutput {
    let instance = instances[instance_index];
    
    let world_pos = vec4<f32>(
        (pos * instance.model_size) + instance.model_pos,
        1.0
    );
    
    var out: VSOutput;
    out.pos = globals.view_proj * world_pos;
    out.normal = normal;
    out.uv = uv;
    out.color = instance.color;
    return out;
}

fn random(co: vec2<f32>) -> f32 {
    return fract(sin(dot(co.xy, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn fs_main(in: VSOutput) -> @location(0) vec4<f32> {
    let dissolveThreshold = fract(globals.time / 5.0) * 0.9;
    let noise = random(in.uv * 10.0);

    if (noise < dissolveThreshold) {
        return vec4<f32>(0.2, 0.0, 0.0, 0.8); // Dark, semi-transparent red for the "ash"
    }

    if (noise < dissolveThreshold + 0.05) {
        return vec4<f32>(1.0, 0.5, 0.0, 1.0); // Emissive edge color
    }

    let lightDir = normalize(vec3<f32>(0.8, 1.0, 0.5));
    let normal = normalize(in.normal);
    let diffuse = max(dot(normal, lightDir), 0.0);
    let ambient = 0.4;
    let finalColor = in.color.rgb * (ambient + diffuse * 0.8);

    return vec4<f32>(finalColor, 1.0);
}
