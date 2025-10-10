// Note: This file now contains the geometry for a sphere (icosphere),
// but retains the name 'cube.ts' to avoid breaking imports.
// It is used by the particle system.

const s = 0.5 / Math.sqrt(1.0*1.0 + ((1.0 + Math.sqrt(5.0)) / 2.0)*((1.0 + Math.sqrt(5.0)) / 2.0));
const t = ((1.0 + Math.sqrt(5.0)) / 2.0) * s;

// The 12 vertices of a icosahedron, scaled to a radius of 0.5
const v = [
    [-s, t, 0], [s, t, 0], [-s, -t, 0], [s, -t, 0],
    [0, -s, t], [0, s, t], [0, -s, -t], [0, s, -t],
    [t, 0, -s], [t, 0, s], [-t, 0, -s], [-t, 0, s]
];

const verts = [];
for (let i = 0; i < v.length; i++) {
    const pos = v[i];
    const len = Math.sqrt(pos[0]*pos[0] + pos[1]*pos[1] + pos[2]*pos[2]);
    const norm = [pos[0]/len, pos[1]/len, pos[2]/len];
    verts.push(...pos, ...norm);
}

export const cubeVertices = new Float32Array(verts);

export const cubeIndices = new Uint16Array([
    0, 11, 5,  0, 5, 1,  0, 1, 7,  0, 7, 10,  0, 10, 11,
    1, 5, 9,  5, 11, 4,  11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4,  3, 4, 2,  3, 2, 6,  3, 6, 8,  3, 8, 9,
    4, 9, 5,  2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1
]);

