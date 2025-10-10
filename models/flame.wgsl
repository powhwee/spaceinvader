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

@fragment
fn fs_main(in: VSOutput) -> @location(0) vec4<f32> {
    let dist = distance(in.uv, vec2(0.5, 0.5));
    let alpha = 1.0 - smoothstep(0.4, 0.5, dist);
    return vec4(in.color.rgb, in.color.a * alpha);
}
