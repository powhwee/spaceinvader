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

// 3D Value Noise for Volumetric density
// 3D Value Noise for Volumetric density
fn hash(p: vec3<f32>) -> f32 {
    var p3 = fract(p * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn noise(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    
    return mix(mix(mix( hash(i + vec3<f32>(0.0,0.0,0.0)), 
                        hash(i + vec3<f32>(1.0,0.0,0.0)), u.x),
                   mix( hash(i + vec3<f32>(0.0,1.0,0.0)), 
                        hash(i + vec3<f32>(1.0,1.0,0.0)), u.x), u.y),
               mix(mix( hash(i + vec3<f32>(0.0,0.0,1.0)), 
                        hash(i + vec3<f32>(1.0,0.0,1.0)), u.x),
                   mix( hash(i + vec3<f32>(0.0,1.0,1.0)), 
                        hash(i + vec3<f32>(1.0,1.0,1.0)), u.x), u.y), u.z);
}

// Distance Field function for a Teardrop
fn sdTeardrop(p: vec3<f32>, r: f32) -> f32 {
    let q = vec3<f32>(p.x, p.y / 2.0 + 0.5, p.z); // Stretch Y
    return length(q) - r;
}

@fragment
fn fs_main(in: VSOutput) -> @location(0) vec4<f32> {
    // Setup Ray
    let uv = in.uv * 2.0 - 1.0;
    
    // Bounds check circular mask to save perf
    if (dot(uv, uv) > 1.0) { discard; }
    
    // Ray Origin & Direction (View Space Slab)
    let ro = vec3<f32>(uv, -1.0);
    // TILT THE RAY: Look nicely "into" the exhaust flow
    let rd = normalize(vec3<f32>(uv.x * 0.5, uv.y * 0.5, 2.0));
    
    // Raymarching Init
    var t_dist = 0.0;
    let t_max = 2.0;
    let steps = 15; // Increased steps for quality
    let step_size = t_max / f32(steps);
    
    var density_acc = 0.0;
    var heat_acc = 0.0;
    
    // Animate noise with position
    // FIX: use .xyz because in.pos is vec4
    // HIGH SPEED Z-SCROLLING to simulate thrust
    let scroll_speed = vec3<f32>(0.0, 0.0, -uniforms.vMatrix[3].z * 5.0); // Use camera Z or just Time if available? 
    // We don't have Time uniform here easily, let's use in.pos.z difference?
    // Actually, let's just use the seed from position and make it extremely turbulent spatially.
    let noise_origin = in.pos.xyz * 0.2; 
    
    for (var i = 0; i < steps; i++) {
        let p = ro + rd * t_dist;
        
        // --- VOLUME DENSITY FUNCTION ---
        // 1. Base Shape: Sphere/Teardrop at center
        // RADIUS TUNING: 0.70 (Slightly smaller as requested)
        let dist = length(p) - 0.70;
        
        // 2. Noise Distortion
        // HIGH FREQ NOISE for "frothy" look
        // We simulate scrolling by adding a huge value to Z based on instance index ??
        // Let's just use spatial noise for now but very strong.
        let noise_val = noise((p + noise_origin) * 4.0);
        
        // 3. Density Calculation
        // ERODE aggressively
        let local_density = max(0.0, -(dist - noise_val * 0.5));
        
        // Accumulate
        // EXTREME DENSITY MULTIPLIER
        density_acc += local_density * step_size * 12.0;
        
        // Heat accumulates closer to core
        heat_acc += max(0.0, -dist) * step_size;
        
        t_dist += step_size;
    }
    
    // Early exit if nothing accumulated
    if (density_acc <= 0.05) { discard; }
    
    // COLOR & OPTICS
    let opacity = clamp(density_acc, 0.0, 1.0);
    
    // Heat Mapping: 
    // RESTORE BLUE/CYAN ION DRIVE
    let heat = clamp(heat_acc * 3.0, 0.0, 1.0);
    let core_color = vec3<f32>(1.0, 1.0, 1.0); // White Hot
    let mid_color = vec3<f32>(0.2, 0.8, 1.0); // Cyan
    let edge_color = vec3<f32>(0.1, 0.0, 0.4); // Dark Purple Smoke
    
    var final_color = mix(edge_color, mid_color, heat);
    final_color = mix(final_color, core_color, heat * heat * heat);
    
    // Apply lifetime fade
    // Density Boost x2.0 for "Massive" look
    let alpha = clamp(opacity * 2.0, 0.0, 1.0) * in.color.a;
    
    return vec4<f32>(final_color * 2.0, alpha);
}
