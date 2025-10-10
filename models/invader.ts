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

