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
    // MATERIAL REMASTER: Force the ship to look newer/shinier than the texture says
    // Scale roughness down (0.0 = mirror, 1.0 = matte). 
    // Changing from raw "pbrMap.g" to "pbrMap.g * 0.3" makes it super glossy.
    let roughness = pbrMap.g * 0.3; 
    
    // Force more metallic look (if the map is gray, push it to white)
    let metallic = max(pbrMap.b, 0.8); 

    // --- RESTORED LIGHTING CALCULATIONS ---
    // Diffuse
    let diffuse_strength = max(dot(N, light_direction), 0.0);
    // Metal absorbs diffuse light (black diffuse), dielectric reflects it
    let diffuse_color = (1.0 - metallic) * linearBaseColor;
    let diffuse = diffuse_strength * diffuse_color * light_color * light_intensity;

    // Specular (Blinn-Phong) - Direct light reflection
    let halfway_vec = normalize(light_direction + view_direction);
    let spec_angle = max(dot(N, halfway_vec), 0.0);
    let spec_power = 2.0 + (1.0 - roughness) * 512.0;
    let specular_strength = pow(spec_angle, spec_power);
    
    // Metal specular is tinted base color, dielectric is white
    let specular_color = mix(vec3<f32>(1.0), linearBaseColor, metallic);
    let specular = specular_strength * specular_color * light_color * specular_intensity;

    // Ambient
    let ambient_intensity = 0.3;
    let ambient_color = vec3<f32>(1.0, 1.0, 1.0);
    let ambient = ambient_intensity * ambient_color * linearBaseColor;

    // Fake IBL (Image Based Lighting)
    let ref_dir = reflect(-view_direction, N);
    let t = ref_dir.y * 0.5 + 0.5; 
    
    // TUNED ENVIRONMENT COLORS: Vibrant Blue Sky
    let sky_color = vec3<f32>(0.0, 0.4, 0.9); // Azure Blue (Visible!)
    let horizon_color = vec3<f32>(0.6, 0.7, 0.9); // Blue-White Horizon
    let ground_color = vec3<f32>(0.05, 0.05, 0.1); // Deep Dark Blue Ground
    
    var env_color = mix(ground_color, horizon_color, smoothstep(0.3, 0.5, t));
    env_color = mix(env_color, sky_color, smoothstep(0.5, 1.0, t));
    
    // Sun Spot
    let sun_spot = pow(max(dot(ref_dir, light_direction), 0.0), 32.0); 
    env_color += vec3<f32>(1.5, 1.3, 1.0) * sun_spot; 

    // Fresnel (Reflection Intensity)
    let f0 = mix(vec3<f32>(0.04), linearBaseColor, metallic);
    let fresnel_env = f0 + (1.0 - f0) * pow(1.0 - max(dot(N, view_direction), 0.0), 5.0);
    let env_reflection = env_color * fresnel_env * (1.0 - roughness);
    
    // Rim Light (Re-added for edge definition)
    let fresnel_rim = pow(1.0 - max(dot(N, view_direction), 0.0), 3.0);
    let rim_color = vec3<f32>(0.4, 0.8, 1.0); // Cyan Rim
    let rim = fresnel_rim * rim_color * 1.5;

    // Combine: Lighting + Reflection + Rim
    var final_color = ambient + diffuse + specular + env_reflection + rim;

    // Manually encode linear color to sRGB space for final output.
    final_color = pow(final_color, vec3<f32>(1.0 / 2.2));

    return vec4<f32>(final_color, srgbColor.a);
}
