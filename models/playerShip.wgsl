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
fn vs_main(
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

@group(0) @binding(2) var mySampler: sampler;
@group(0) @binding(3) var baseColorTexture: texture_2d<f32>;
@group(0) @binding(4) var metallicRoughnessTexture: texture_2d<f32>;

@fragment
fn fs_main(
    @location(1) normal: vec3<f32>,
    @location(3) uv: vec2<f32>
) -> @location(0) vec4<f32> {
    let light_intensity = 2.5;
    let specular_intensity = 0.5;
    let light_color = vec3<f32>(1.0, 1.0, 1.0);
    let light_direction = normalize(vec3<f32>(0.3, 1.0, 0.7));
    let view_direction = normalize(vec3<f32>(0.0, 0.5, 1.0)); // Assumes a fixed view relative to the object
    let N = normalize(normal);

    // Manually decode sRGB texture to linear space.
    let srgbColor = textureSample(baseColorTexture, mySampler, uv);
    let linearBaseColor = pow(srgbColor.rgb, vec3<f32>(2.2));

    let pbrMap = textureSample(metallicRoughnessTexture, mySampler, uv);
    let roughness = pbrMap.g; // Roughness is usually in the Green channel
    let metallic = pbrMap.b; // Metallic is usually in the Blue channel

    // Diffuse
    let diffuse_strength = max(dot(N, light_direction), 0.0);
    let diffuse_color = (1.0 - metallic) * linearBaseColor;
    let diffuse = diffuse_strength * diffuse_color * light_color * light_intensity;

    // Specular (Blinn-Phong)
    let halfway_vec = normalize(light_direction + view_direction);
    let spec_angle = max(dot(N, halfway_vec), 0.0);
    let spec_power = 2.0 + (1.0 - roughness) * 512.0;
    let specular_strength = pow(spec_angle, spec_power);
    
    let specular_color = mix(vec3<f32>(1.0), linearBaseColor, metallic);
    let specular = specular_strength * specular_color * light_color * specular_intensity;

    // Ambient
    let ambient_intensity = 0.3;
    let ambient_color = vec3<f32>(1.0, 1.0, 1.0);
    // Ambient light should also be tinted by the object's linear color
    let ambient = ambient_intensity * ambient_color * linearBaseColor;

    var final_color = ambient + diffuse + specular;

    // Manually encode linear color to sRGB space for final output.
    final_color = pow(final_color, vec3<f32>(1.0 / 2.2));

    return vec4<f32>(final_color, srgbColor.a);
}
