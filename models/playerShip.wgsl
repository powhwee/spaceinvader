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
    time: f32, // Added to match renderer.ts alignment
    padding_1: f32,
    padding_2: f32,
    padding_3: f32,
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

// Helper to generate stars
fn getStarIntensity(dir: vec3<f32>, time: f32) -> f32 {
    // 1. Rotation for movement (Gliding)
    let speed = 0.5; // Slower, majestic glide
    let angle = time * speed;
    let s = sin(angle);
    let c = cos(angle);
    let rot_dir = vec3<f32>(dir.x * c - dir.z * s, dir.y, dir.x * s + dir.z * c);

    // 2. Continuous Interference Pattern (No Flickering!)
    // We use sine waves to create a smooth grid of glowing spots.
    // Raising the minimal sine overlap to a high power makes them tiny sharp dots.
    
    let scale = 8.0; // Reduced density for mobile (fewer stars)
    let pos = rot_dir * scale;
    
    // Create broad, smooth peaks
    let raw_noise = sin(pos.x) * sin(pos.y * 1.3) * sin(pos.z * 0.7); 
    
    // Sharpen peaks into stars
    // pow(..., 4.0) makes huge, soft glowing orbs (highly visible on small screens)
    return pow(max(0.0, raw_noise), 4.0); 
}

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
    
    // --- INTELLIGENT MATERIAL PARSING ---
    // 1. Check Blue Channel (Metalness) - Glass should be 0.0
    // 2. Check Base Color Brightness - Window is usually painted dark/black.
    // We combine these to be sure we catch the window.
    let is_metal_low = 1.0 - smoothstep(0.0, 0.1, pbrMap.b);
    let is_color_dark = 1.0 - smoothstep(0.0, 0.1, length(linearBaseColor)); 
    let is_glass = max(is_metal_low, is_color_dark); // Logical OR
    
    // Hull Properties: Metallic, slightly rough
    let hull_roughness = pbrMap.g * 0.3;
    let hull_metallic = max(pbrMap.b, 0.8);
    
    // Glass Properties: Smooth mirror, dielectric (non-metal)
    let glass_roughness = 0.0;
    let glass_metallic = 0.0;
    
    let roughness = mix(hull_roughness, glass_roughness, is_glass);
    let metallic = mix(hull_metallic, glass_metallic, is_glass);

    // --- LIGHTING ---
    // Diffuse
    let diffuse_strength = max(dot(N, light_direction), 0.0);
    let diffuse_color = (1.0 - metallic) * linearBaseColor;
    let diffuse = diffuse_strength * diffuse_color * light_color * light_intensity;

    // Specular
    let halfway_vec = normalize(light_direction + view_direction);
    let spec_angle = max(dot(N, halfway_vec), 0.0);
    let spec_power = 2.0 + (1.0 - roughness) * 512.0;
    let specular_strength = pow(spec_angle, spec_power);
    let specular_color = mix(vec3<f32>(1.0), linearBaseColor, metallic);
    let specular = specular_strength * specular_color * light_color * specular_intensity;
    // Ambient
    let ambient_intensity = 0.3;
    let ambient_color = vec3<f32>(1.0, 1.0, 1.0);
    let ambient = ambient_intensity * ambient_color * linearBaseColor;

    // --- FAKE IBL + STARLIGHT ---
    let ref_dir = reflect(-view_direction, N);
    let t = ref_dir.y * 0.5 + 0.5; 
    
    // Environment Colors
    let sky_color = vec3<f32>(0.0, 0.4, 0.9);
    let horizon_color = vec3<f32>(0.6, 0.7, 0.9);
    let ground_color = vec3<f32>(0.05, 0.05, 0.1);
    
    var env_color = mix(ground_color, horizon_color, smoothstep(0.3, 0.5, t));
    env_color = mix(env_color, sky_color, smoothstep(0.5, 1.0, t));
    
    // Sun Spot
    let sun_spot = pow(max(dot(ref_dir, light_direction), 0.0), 32.0); 
    env_color += vec3<f32>(1.5, 1.3, 1.0) * sun_spot; 

    // --- PROCEDURAL STARLIGHT ---
    // Show stars mostly in the upper hemisphere
    if (t > 0.3) {
        let star_brightness = getStarIntensity(ref_dir, globals.time);
        
        // PHYSICS COMPENSATION:
        // Glass only reflects ~4% of light at normal incidence (looking straight at it).
        // To make stars visible, they need to be blindingly bright (HDR).
        // Boosting from 5.0 -> 80.0 ensures roughly 3.0 reaches the eye (80 * 0.04).
        env_color += vec3<f32>(80.0, 80.0, 100.0) * star_brightness;
    }

    // Fresnel
    let f0 = mix(vec3<f32>(0.04), linearBaseColor, metallic);
    let fresnel_env = f0 + (1.0 - f0) * pow(1.0 - max(dot(N, view_direction), 0.0), 5.0);
    
    // Apply reflection
    // If it's glass, we want pure reflection
    let env_reflection = env_color * fresnel_env * (1.0 - roughness);
    
    // Rim Light
    let fresnel_rim = pow(1.0 - max(dot(N, view_direction), 0.0), 3.0);
    let rim_color = vec3<f32>(0.4, 0.8, 1.0); 
    let rim = fresnel_rim * rim_color * 1.5;

    // Combine
    var final_color = ambient + diffuse + specular + env_reflection + rim;

    // Manually encode linear color to sRGB space for final output.
    final_color = pow(final_color, vec3<f32>(1.0 / 2.2));

    return vec4<f32>(final_color, srgbColor.a);
}
