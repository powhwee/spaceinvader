// The u,v coordinates are not for texture mapping in the traditional sense.
// Instead, they provide a stable 2D coordinate system on the surface of the 3D model.
// The fragment shader uses these coordinates as input to a noise function,
// which generates a procedural pattern used for the "dissolve" effect.


function generateInvaderData() {
    const invaderShape = [
        [0,0], [3,0], [4,0], [5,0], [6,0], [9,0], [1,1], [2,1], [7,1], [8,1],
        [0,2], [1,2], [2,2], [3,2], [4,2], [5,2], [6,2], [7,2], [8,2], [9,2],
        [0,3], [2,3], [3,3], [4,3], [5,3], [6,3], [7,3], [9,3], [2,4], [7,4]
    ];

    // prettier-ignore
    const singleCubeVertices = [
        // pos(x,y,z),    normal(x,y,z),    uv(u,v)
        // Front face (+z)
        -0.5, -0.5,  0.5,   0, 0, 1,  0, 0,
         0.5, -0.5,  0.5,   0, 0, 1,  1, 0,
         0.5,  0.5,  0.5,   0, 0, 1,  1, 1,
        -0.5, -0.5,  0.5,   0, 0, 1,  0, 0,
         0.5,  0.5,  0.5,   0, 0, 1,  1, 1,
        -0.5,  0.5,  0.5,   0, 0, 1,  0, 1,
        // Back face (-z)
        -0.5, -0.5, -0.5,   0, 0, -1, 1, 0,
        -0.5,  0.5, -0.5,   0, 0, -1, 1, 1,
         0.5,  0.5, -0.5,   0, 0, -1, 0, 1,
        -0.5, -0.5, -0.5,   0, 0, -1, 1, 0,
         0.5,  0.5, -0.5,   0, 0, -1, 0, 1,
         0.5, -0.5, -0.5,   0, 0, -1, 0, 0,
        // Top face (+y)
        -0.5,  0.5, -0.5,   0, 1, 0,  0, 1,
        -0.5,  0.5,  0.5,   0, 1, 0,  0, 0,
         0.5,  0.5,  0.5,   0, 1, 0,  1, 0,
        -0.5,  0.5, -0.5,   0, 1, 0,  0, 1,
         0.5,  0.5,  0.5,   0, 1, 0,  1, 0,
         0.5,  0.5, -0.5,   0, 1, 0,  1, 1,
        // Bottom face (-y)
        -0.5, -0.5, -0.5,   0, -1, 0, 0, 0,
         0.5, -0.5, -0.5,   0, -1, 0, 1, 0,
         0.5, -0.5,  0.5,   0, -1, 0, 1, 1,
        -0.5, -0.5, -0.5,   0, -1, 0, 0, 0,
         0.5, -0.5,  0.5,   0, -1, 0, 1, 1,
        -0.5, -0.5,  0.5,   0, -1, 0, 0, 1,
        // Right face (+x)
         0.5, -0.5, -0.5,   1, 0, 0,  0, 0,
         0.5,  0.5, -0.5,   1, 0, 0,  1, 0,
         0.5,  0.5,  0.5,   1, 0, 0,  1, 1,
         0.5, -0.5, -0.5,   1, 0, 0,  0, 0,
         0.5,  0.5,  0.5,   1, 0, 0,  1, 1,
         0.5, -0.5,  0.5,   1, 0, 0,  0, 1,
        // Left face (-x)
        -0.5, -0.5, -0.5,  -1, 0, 0,  1, 0,
        -0.5, -0.5,  0.5,  -1, 0, 0,  0, 0,
        -0.5,  0.5,  0.5,  -1, 0, 0,  0, 1,
        -0.5, -0.5, -0.5,  -1, 0, 0,  1, 0,
        -0.5,  0.5,  0.5,  -1, 0, 0,  0, 1,
        -0.5,  0.5, -0.5,  -1, 0, 0,  1, 1,
    ];

    const fullInvaderVerticesList = [];
    const vertexSize = 8; // 3 for pos, 3 for normal, 2 for uv
    const scale = 0.1;

    invaderShape.forEach(([x, y]) => {
        const offsetX = x - 4.5;
        const offsetY = -y + 2.0;
        const offsetZ = 0;

        for (let i = 0; i < singleCubeVertices.length; i += vertexSize) {
            fullInvaderVerticesList.push((singleCubeVertices[i + 0] + offsetX) * scale);
            fullInvaderVerticesList.push((singleCubeVertices[i + 1] + offsetY) * scale);
            fullInvaderVerticesList.push((singleCubeVertices[i + 2] + offsetZ) * scale);
            fullInvaderVerticesList.push(...singleCubeVertices.slice(i + 3, i + 8));
        }
    });

    const vertexMap = new Map();
    const uniqueVertices = [];
    const indices = [];
    const fullInvaderVerticesArray = new Float32Array(fullInvaderVerticesList);

    // Process each vertex of the non-indexed list
    for (let i = 0; i < fullInvaderVerticesArray.length / vertexSize; i++) {
        const vertexOffset = i * vertexSize;
        // Create a subarray for the current vertex's data
        const vertex = fullInvaderVerticesArray.slice(vertexOffset, vertexOffset + vertexSize);
        // Create a string key to uniquely identify the vertex data
        const key = Array.from(vertex).map(v => v.toPrecision(4)).join(',');

        let index = vertexMap.get(key);
        if (index === undefined) {
            // If we haven't seen this vertex before, add it to our unique list
            index = uniqueVertices.length / vertexSize;
            uniqueVertices.push(...vertex);
            vertexMap.set(key, index);
        }
        // Add the index for this vertex to our index list
        indices.push(index);
    }

    return {
        vertices: new Float32Array(uniqueVertices),
        indices: new Uint32Array(indices),
        baseDimensions: { width: 1.0, height: 0.5, depth: 0.1 },
    };
}

const invaderData = generateInvaderData();
export const invaderVertices = invaderData.vertices;
export const invaderIndices = invaderData.indices;
export const invaderBaseDimensions = invaderData.baseDimensions;

export const invaderShader = `
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
`;
