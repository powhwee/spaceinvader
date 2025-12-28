struct VertexInput {
    @builtin(vertex_index) vertex_index : u32,
};

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

struct Uniforms {
    view_proj: mat4x4<f32>,
    time: f32,
    aspect_ratio: f32,
    vertical_fov: f32,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var myTexture: texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    // Standard full-screen triangle
    var pos = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );

    var out: VertexOutput;
    out.position = vec4<f32>(pos[vertex_index], 0.9999, 1.0);
    // Map position (-1..3) to UV (0..2)
    out.uv = vec2<f32>((pos[vertex_index].x + 1.0) * 0.5, (1.0 - pos[vertex_index].y) * 0.5);
    return out;
}

fn intersectSphere(ro: vec3<f32>, rd: vec3<f32>, s: vec4<f32>) -> f32 {
    let oc = ro - s.xyz;
    let b = dot(oc, rd);
    let c = dot(oc, oc) - s.w * s.w;
    let h = b * b - c;
    if (h < 0.0) {
        return -1.0;
    }
    return -b - sqrt(h);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Ray generation (Orthographic to fix distortion)
    let uv = input.uv * 2.0 - 1.0;
    
    let dist_z = 15.0;
    let tan_half_fov = tan(uniforms.vertical_fov * 0.5);
    
    // Calculate the physical size of the view plane at this depth
    let view_height = 2.0 * dist_z * tan_half_fov;
    let view_width = view_height * uniforms.aspect_ratio;
    
    // Orthographic ray origin varies across the screen
    let ro_x = uv.x * (view_width * 0.5);
    // Note: uv.y is -1..1 (bottom to top). 
    // In our view, y is up. So this maps correctly to height.
    let ro_y = uv.y * (view_height * 0.5);
    
    // Ray Origin depends on pixel, starting at camera plane
    let ro = vec3<f32>(ro_x, ro_y, 5.0);
    // Parallel rays for orthographic projection, eliminating distortion
    let rd = vec3<f32>(0.0, 0.0, -1.0); 
    
    // Dynamic positioning to anchor to the right edge
    let frustum_right_edge = view_width * 0.5;
    
    // Position sphere so its right edge touches the screen edge (minus padding)
    // Radius 2.7 (2.25 * 1.2)
    // Margin of 1.0. Offset = 2.7 + 1.0 = 3.7
    let sphere_x = frustum_right_edge - 3.7; 

    let sphere = vec4<f32>(sphere_x, -2.5, -10.0, 2.7); // x, y, z, radius
    
    let t = intersectSphere(ro, rd, sphere);

    if (t > 0.0) {
        let p = ro + t * rd;
        var n = normalize(p - sphere.xyz);
        
        // Tilt: Rotate normal around Z axis by -15 degrees (-0.2618 radians) for right tilt
        let tilt = -0.2618; 
        let c = cos(tilt);
        let s = sin(tilt);
        let nx = n.x * c - n.y * s;
        let ny = n.x * s + n.y * c;
        n = vec3<f32>(nx, ny, n.z);

        // Spherical UV mapping
        let u = 0.5 + atan2(n.z, n.x) / (2.0 * 3.14159);
        let v = 0.5 - asin(n.y) / 3.14159;
        
        // Rotation
        let rotation_speed = 0.05;
        let rotated_u = fract(u + uniforms.time * rotation_speed);

        // Simple lighting
        let light_dir = normalize(vec3<f32>(1.0, 0.5, 1.0));
        let diff = max(dot(n, light_dir), 0.1); // Ambient 0.1
        
        // Sample texture using explicit LOD
        let texColor = textureSampleLevel(myTexture, mySampler, vec2<f32>(rotated_u, v), 0.0);
        
        return vec4<f32>(texColor.rgb * diff, 1.0);
    }

    // Space background color
    return vec4<f32>(0.02, 0.02, 0.05, 1.0);
}
