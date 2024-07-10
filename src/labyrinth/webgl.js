import { CUBE_INDICES, CUBE_VERTICES, TABLE_INDICES, TABLE_VERTICES, WALL_VERTICES, create3dPosColorInterleavedVao } from "./geometry.js";
import { createProgram, createStaticIndexBuffer, createStaticVertexBuffer, getContext, showError } from "./utils.js";
const { glMatrix, mat4, quat, vec3 } = window.glMatrix;

let crosshair = document.querySelector("#maze");
crosshair.id = "";
crosshair.className = "crosshair";

const canvas = document.querySelector("canvas");
canvas.style = "";
canvas.width = innerWidth;
canvas.height = innerHeight;

const fps = document.createElement("div");
fps.style = `position: absolute; top: 0; left: 0; color: white;`;
document.body.append(fps);

const vertexShaderSourceCode = await fetch("src/labyrinth/shaders/vertex.glsl").then((x) => x.text());
const fragmentShaderSourceCode = await fetch("src/labyrinth/shaders/fragment.glsl").then((x) => x.text());

class Shape {
    matWorld = mat4.create();
    // scaleVec = vec3.create();
    rotation = quat.create();

    constructor(pos, scale, rotationAxis, rotationAngle, vao, numIndices) {
        this.pos = pos;
        this.scaleVec = scale;
        this.rotationAxis = rotationAxis;
        this.rotationAngle = rotationAngle;
        this.vao = vao;
        this.numIndices = numIndices;
    }

    draw(gl, matWorldUniform) {
        quat.setAxisAngle(this.rotation, this.rotationAxis, this.rotationAngle);

        mat4.fromRotationTranslationScale(this.matWorld, /* rotation= */ this.rotation, /* position= */ this.pos, /* scale= */ this.scaleVec);

        gl.uniformMatrix4fv(matWorldUniform, false, this.matWorld);
        gl.bindVertexArray(this.vao);
        gl.drawElements(gl.TRIANGLES, this.numIndices, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(null);
    }
}

export class MazeShape {
    static scale = 3;
    static rotationAxis = [0, 1, 0];
    static rotationAngle = 0;

    static cellSize = 1;
    static wallThickness = 0.1;
    static wallHeight = 1;

    vertexBuf;
    indexBuf;
    gl;
    vao;

    matWorld = mat4.create();
    scaleVec = vec3.create();
    rotation = quat.create();

    pos;

    verticies;
    indicies; // = new Uint16Array([0, 1, 2, 0, 2, 3]);
    numInds = 6;
    lastMaze;
    curMaze;
    stretchArr;
    constructor(gl, mazeData, posAttrib, colorAttrib) {
        this.mazeData = mazeData;
        this.gl = gl;
        this.vertexBuf = this.createBuffer();
        this.indexBuf = this.createBuffer();
        this.vao = this.createMazeVao(posAttrib);
        this.wallVao = this.createMazeWallVao(posAttrib, colorAttrib);
        // this.pos = [(this.mazeData.size.ROWS * MazeShape.cellSize * MazeShape.scale) / 2, 0, (-this.mazeData.size.COLS * MazeShape.cellSize * MazeShape.scale) / 2];
        this.pos = [0, 0, 0];

        this.curMaze = mazeData.maze;
        const { ROWS, COLS } = this.mazeData.size;
        const { cellSize, wallThickness, wallHeight } = MazeShape;

        this.verticies = new Float32Array(ROWS * COLS * 12 * 2);
        const groundOffset = (this.groundOffset = ROWS * COLS * 4) * 3;
        let i = 0;
        const addVert = (x, z) => {
            this.verticies[i + groundOffset] = this.verticies[i++] = x;
            this.verticies[i + groundOffset] = 0;
            this.verticies[i++] = wallHeight;
            this.verticies[i + groundOffset] = this.verticies[i++] = z;
        };
        const halfR = (ROWS * cellSize) / 2;
        const halfC = (COLS * cellSize) / 2;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const cellPos = [c * cellSize - halfC, -r * cellSize + halfR];
                addVert(cellPos[0] + wallThickness, cellPos[1] - wallThickness);
                addVert(cellPos[0] + cellSize - wallThickness, cellPos[1] - wallThickness);
                addVert(cellPos[0] + cellSize - wallThickness, cellPos[1] - cellSize + wallThickness);
                addVert(cellPos[0] + wallThickness, cellPos[1] - cellSize + wallThickness);
            }
        }
        this.updateVertexBuffer();
        console.log((window.mazeShape = this), i);
        this.indicies = new Uint16Array(ROWS * COLS * 12 * 2);
        this.stretchArr = new Array(COLS);
        window.addEventListener("keydown", (e) => e.code == "KeyG" && this.initMaze());
        this.initMaze();

        // quat.setAxisAngle(this.rotation, MazeShape.rotationAxis, MazeShape.rotationAngle);
        // vec3.set(this.scaleVec, MazeShape.scale, MazeShape.scale, MazeShape.scale);

        mat4.fromRotationTranslationScale(this.matWorld, /* rotation= */ quat.setAxisAngle([], MazeShape.rotationAxis, MazeShape.rotationAngle), /* position= */ this.pos, /* scale= */ [MazeShape.scale, MazeShape.scale, MazeShape.scale]);
    }
    isOrigin(row, col) {
        const o = this.mazeData.origin;
        return row == o[0] && col == o[1];
    }
    isValidCell(row, col) {
        return row >= 0 && row < this.mazeData.size.ROWS && col >= 0 && col < this.mazeData.size.COLS;
    }
    getCell(row, col, maze) {
        if (this.isValidCell(row, col)) return (maze || this.mazeData.maze)[row * this.mazeData.size.COLS + col];
    }
    canConnectRight(row, col, maze) {
        // return !this.isOrigin(row, col) && !this.isOrigin(row, col + 1) &&
        return this.getCell(row, col, maze) === 1 || this.getCell(row, col + 1, maze) === 3;
    }
    canConnectUp(row, col, maze) {
        // return !this.isOrigin(row, col) && !this.isOrigin(row - 1, col) &&
        return this.getCell(row, col, maze) === 0 || this.getCell(row - 1, col, maze) === 2;
    }
    addInd(val) {
        if (this.numInds == this.indicies.length) {
            const old = this.indicies;
            this.indicies = new Uint16Array(this.numInds * 2);
            for (let i = 0; i < this.numInds; i++) this.indicies[i] = old[i];
        }
        return (this.indicies[this.numInds++] = val);
    }
    getInd(row, col, low) {
        return (row * this.mazeData.size.COLS + col) * 4 + (low ? this.groundOffset : 0);
    }
    fromInd(ind) {
        const cols = this.mazeData.size.COLS;
        const i = Math.floor(ind / 4);
        return [Math.floor(i / cols), i % cols];
    }
    addFace(first, second, third, fourth) {
        this.addInd(first);
        this.addInd(second);
        this.addInd(third);
        this.addInd(first);
        this.addInd(third);
        this.addInd(fourth);
    }
    initMaze() {
        // cell corners = (c * cellSize, r * cellSize)
        /**
         * cell walls =
         * (corner.x + wallThickness,                       corner.y + wallThickness)
         * (corner.x + cellSize - wallThickness,            corner.y + wallThickness)
         * (corner.x + wallThickness,            corner.y + cellSize - wallThickness)
         * (corner.x + cellSize - wallThickness, corner.y + cellSize - wallThickness)
         *
         */
        /**
         * vertex inds
         * (r * COLS + c) * 4
         * (r * COLS + c) * 4 + 1
         * (r * COLS + c) * 4 + 2
         * (r * COLS + c) * 4 + 3
         */
        this.numInds = 0;
        const { ROWS, COLS } = this.mazeData.size;
        const stretchArr = this.stretchArr;
        stretchArr.fill(-1);
        for (let r = 0; r < ROWS; r++) {
            let stretch = -1;
            for (let c = 0; c < COLS; c++) {
                if (r >= 1 && !this.canConnectUp(r, c) && c >= stretch) {
                    stretch = c;
                    while (stretch < COLS && !this.canConnectUp(r, stretch)) stretch++;
                    let upLeft = this.getInd(r - 1, c - 1) + 2,
                        downLeft = this.getInd(r, c - 1) + 1,
                        upRight = this.getInd(r - 1, stretch) + 3,
                        downRight = this.getInd(r, stretch);
                    if (c == 0) {
                        upLeft = this.getInd(r - 1, c) + 3;
                        downLeft = this.getInd(r, c);
                    }
                    if (stretch == COLS) {
                        upRight = this.getInd(r - 1, stretch - 1) + 2;
                        downRight = this.getInd(r, stretch - 1) + 1;
                    }
                    this.addFace(upLeft, upRight, downRight, downLeft);

                    this.addFace(upLeft, downLeft, downLeft + this.groundOffset, upLeft + this.groundOffset);
                    this.addFace(upRight, upLeft, upLeft + this.groundOffset, upRight + this.groundOffset);
                    this.addFace(downRight, upRight, upRight + this.groundOffset, downRight + this.groundOffset);
                    this.addFace(downLeft, downRight, downRight + this.groundOffset, downLeft + this.groundOffset);
                }
                if (c + 1 < COLS && !this.canConnectRight(r, c) && r >= stretchArr[c]) {
                    stretchArr[c] = r;
                    while (stretchArr[c] < ROWS && !this.canConnectRight(stretchArr[c], c)) stretchArr[c]++;
                    let upLeft = this.getInd(r - 1, c) + 2,
                        upRight = this.getInd(r - 1, c + 1) + 3,
                        downLeft = this.getInd(stretchArr[c], c) + 1,
                        downRight = this.getInd(stretchArr[c], c + 1);
                    if (r == 0) {
                        upLeft = this.getInd(r, c) + 1;
                        upRight = this.getInd(r, c + 1);
                    }
                    if (stretchArr[c] == ROWS) {
                        downLeft = this.getInd(stretchArr[c] - 1, c) + 2;
                        downRight = this.getInd(stretchArr[c] - 1, c + 1) + 3;
                    }
                    this.addFace(upLeft, upRight, downRight, downLeft);

                    this.addFace(upLeft, downLeft, downLeft + this.groundOffset, upLeft + this.groundOffset);
                    this.addFace(upRight, upLeft, upLeft + this.groundOffset, upRight + this.groundOffset);
                    this.addFace(downRight, upRight, upRight + this.groundOffset, downRight + this.groundOffset);
                    this.addFace(downLeft, downRight, downRight + this.groundOffset, downLeft + this.groundOffset);
                }
            }
        }
        this.updateIndexBuffer();
        this.lastMaze = this.mazeData.maze;
        console.log(this.numInds);
    }
    findInd(first, last) {
        let i;
        for (i = 0; i < this.indicies.length && this.indicies[i] != this.indicies[i + 1]; i += 6) if (this.indicies[i] == first && this.indicies[i + 3] == first && this.indicies[i + 5] == last) return i;
        // if (i == this.numInds) console.log("ruh roh 1");
        return i;
    }
    findInd2(first, second) {
        let i;
        for (i = 0; i < this.indicies.length && this.indicies[i] != this.indicies[i + 1]; i += 6) if (this.indicies[i] == first && this.indicies[i + 3] == first && this.indicies[i + 1] == second) return i;
        // if (i == this.numInds) console.log("ruh roh 2");
        return i;
    }
    test = 0;
    updateMaze() {
        ++this.test;
        // cell corners = (c * cellSize, r * cellSize)
        /**
         * cell walls =
         * (corner.x + wallThickness,                       corner.y + wallThickness)
         * (corner.x + cellSize - wallThickness,            corner.y + wallThickness)
         * (corner.x + wallThickness,            corner.y + cellSize - wallThickness)
         * (corner.x + cellSize - wallThickness, corner.y + cellSize - wallThickness)
         *
         */
        /**
         * vertex inds
         * (r * COLS + c) * 4
         * (r * COLS + c) * 4 + 1
         * (r * COLS + c) * 4 + 2
         * (r * COLS + c) * 4 + 3
         */
        const {
            size: { ROWS, COLS },
            origin,
        } = this.mazeData;

        // console.log(origin);

        const faces = [];
        const addFace = (a, b, c, d) => {
            if (a == b) return;
            faces.push(a, b, c, a, c, d);

            faces.push(a, d, d + this.groundOffset, a, d + this.groundOffset, a + this.groundOffset);
            faces.push(b, a, a + this.groundOffset, b, a + this.groundOffset, b + this.groundOffset);
            faces.push(c, b, b + this.groundOffset, c, b + this.groundOffset, c + this.groundOffset);
            faces.push(d, c, c + this.groundOffset, d, c + this.groundOffset, d + this.groundOffset);
        };
        const removeInd = (ind) => {
            if (ind >= this.numInds) return false;
            trashInds.push(ind);
            return ind;
        };
        const trashInds = [];
        for (let r = Math.max(0, origin[0] - 2); r < Math.min(ROWS, origin[0] + 2); r++) {
            let stretch;
            for (let c = Math.max(0, origin[1] - 2); c < Math.min(COLS, origin[1] + 2); c++) {
                const canUp = this.canConnectUp(r, c); // add gap
                const couldUp = this.canConnectUp(r, c, this.lastMaze); // remove gap
                if (canUp != couldUp) {
                    let leftC = c - 1;
                    while (leftC >= 0 && !this.canConnectUp(r, leftC)) leftC--;
                    leftC++;
                    let upLeft = leftC == 0 ? this.getInd(r - 1, leftC) + 3 : this.getInd(r - 1, leftC - 1) + 2,
                        downLeft = leftC == 0 ? this.getInd(r, leftC) : this.getInd(r, leftC - 1) + 1,
                        upRight,
                        downRight;
                    // remove left or whole row
                    removeInd(this.findInd(upLeft, downLeft));

                    if (canUp) {
                        // add left
                        upRight = this.getInd(r - 1, c) + 3;
                        downRight = this.getInd(r, c);
                        if (upLeft + 5 != upRight) addFace(upLeft, upRight, downRight, downLeft);
                        if (c != COLS - 1) {
                            // add right
                            stretch = c + 1;
                            while (stretch < COLS && !this.canConnectUp(r, stretch)) stretch++;
                            upLeft = this.getInd(r - 1, c) + 2;
                            downLeft = this.getInd(r, c) + 1;
                            upRight = stretch == COLS ? this.getInd(r - 1, stretch - 1) + 2 : this.getInd(r - 1, stretch) + 3;
                            downRight = stretch == COLS ? this.getInd(r, stretch - 1) + 1 : this.getInd(r, stretch);
                            if (upLeft + 5 != upRight) addFace(upLeft, upRight, downRight, downLeft);
                        }
                    } else {
                        // remove right if valid and had a wall
                        if (c + 1 < COLS && !this.canConnectUp(r, c + 1, this.lastMaze)) {
                            removeInd(this.findInd(this.getInd(r - 1, c) + 2, this.getInd(r, c) + 1));
                        }
                        // add row
                        stretch = leftC;
                        while (stretch < COLS && !this.canConnectUp(r, stretch)) stretch++;
                        upRight = stretch == COLS ? this.getInd(r - 1, stretch - 1) + 2 : this.getInd(r - 1, stretch) + 3;
                        downRight = stretch == COLS ? this.getInd(r, stretch - 1) + 1 : this.getInd(r, stretch);
                        addFace(upLeft, upRight, downRight, downLeft);
                    }
                }
                const canRight = this.canConnectRight(r, c); // add gap
                const couldRight = this.canConnectRight(r, c, this.lastMaze); // remove gap
                if (canRight != couldRight) {
                    let topR = r - 1;
                    while (topR >= 0 && !this.canConnectRight(topR, c)) topR--;
                    topR++;
                    let upLeft = topR == 0 ? this.getInd(topR, c) + 1 : this.getInd(topR - 1, c) + 2,
                        upRight = topR == 0 ? this.getInd(topR, c + 1) : this.getInd(topR - 1, c + 1) + 3,
                        downLeft,
                        downRight;
                    removeInd(this.findInd2(upLeft, upRight)); // remove top / bottom
                    if (canRight) {
                        // add top
                        downLeft = this.getInd(r, c) + 1;
                        downRight = this.getInd(r, c + 1);
                        if (r != topR) addFace(upLeft, upRight, downRight, downLeft);
                        // add bottom
                        if (r != ROWS - 1) {
                            stretch = r + 1;
                            while (stretch < ROWS && !this.canConnectRight(stretch, c)) stretch++;
                            upLeft = this.getInd(r, c) + 2;
                            upRight = this.getInd(r, c + 1) + 3;
                            downLeft = stretch == ROWS ? this.getInd(stretch - 1, c) + 2 : this.getInd(stretch, c) + 1;
                            downRight = stretch == ROWS ? this.getInd(stretch - 1, c + 1) + 3 : this.getInd(stretch, c + 1);
                            if (r + 1 != stretch) addFace(upLeft, upRight, downRight, downLeft);
                        }
                    } else {
                        // remove bottom if valid and has wall
                        if (r + 1 < ROWS && !this.canConnectRight(r + 1, c, this.lastMaze)) removeInd(this.findInd2(this.getInd(r, c) + 2, this.getInd(r, c + 1) + 3));
                        // add column
                        stretch = topR;
                        while (stretch < ROWS && !this.canConnectRight(stretch, c)) stretch++;
                        downLeft = stretch == ROWS ? this.getInd(stretch - 1, c) + 2 : this.getInd(stretch, c) + 1;
                        downRight = stretch == ROWS ? this.getInd(stretch - 1, c + 1) + 3 : this.getInd(stretch, c + 1);
                        addFace(upLeft, upRight, downRight, downLeft);
                    }
                }
            }
        }
        let i = 0,
            k = 0;

        // let oldNum = this.numInds;

        trashInds.sort((a, b) => a - b);

        for (const ind of trashInds) for (let i = 0; i < 30; i++) this.indicies[ind + i] = 0;

        while (i < trashInds.length && k < faces.length) {
            const ind = trashInds[i++];
            for (let i = 0; i < 30; i++) this.indicies[ind + i] = faces[k++];
        }
        while (k < faces.length) this.addInd(faces[k++]);
        if (i < trashInds.length) {
            let cur = trashInds[i],
                next = cur,
                temp;
            while (next < this.numInds) {
                if (this.indicies[next] != 0 || this.indicies[next + 1] != 0) {
                    for (let i = 0; i < 30; i++) {
                        temp = this.indicies[cur];
                        this.indicies[cur] = this.indicies[next + i];
                        this.indicies[next + i] = temp;
                        cur++;
                    }
                }
                next += 30;
            }
            this.numInds = cur;
        }
        // console.log(origin, this.test, trashInds.length, faces.length / 6, oldNum + faces.length - trashInds.length * 6, this.numInds, trashInds);
        this.updateIndexBuffer();
        this.lastMaze = this.mazeData.maze;
    }
    createBuffer() {
        const buffer = this.gl.createBuffer();
        if (buffer) return buffer;
        showError("Failed to allocate buffer");
    }
    updateVertexBuffer() {
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuf);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.verticies, this.gl.STATIC_DRAW);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
    }
    updateIndexBuffer() {
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
        // const inds = this.indicies.slice();
        // for (let i = 0; i < this.numInds; i++) {
        //     if (this.verticies[inds[i]] != this.verticies[inds[i] + this.groundOffset]) console.log(inds[i]);
        //     // this.verticies[inds[i] + this.groundOffset] = this.verticies[inds[i]];
        //     inds[i] += this.groundOffset;
        // }

        this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, this.indicies, this.gl.STATIC_DRAW);

        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);
    }
    createMazeVao(posAttrib) {
        const vao = this.gl.createVertexArray();
        if (!vao) {
            showError("Failed to create VAO");
            return null;
        }

        this.gl.bindVertexArray(vao);

        this.gl.enableVertexAttribArray(posAttrib);

        // Interleaved format: (x, y, z) (all f32)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuf);
        this.gl.vertexAttribPointer(posAttrib, 3, this.gl.FLOAT, false, 3 * Float32Array.BYTES_PER_ELEMENT, 0);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);

        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
        this.gl.bindVertexArray(null);

        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null); // Not sure if necessary, but not a bad idea.

        return vao;
    }
    createMazeWallVao(posAttrib, colorAttrib) {
        const vao = this.gl.createVertexArray();
        if (!vao) {
            showError("Failed to create VAO");
            return null;
        }

        this.gl.bindVertexArray(vao);

        this.gl.enableVertexAttribArray(posAttrib);
        this.gl.enableVertexAttribArray(colorAttrib);

        const { ROWS, COLS } = this.mazeData.size;
        const { cellSize, wallThickness, wallHeight } = MazeShape;

        const vertexBuf = this.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertexBuf);
        const verts = WALL_VERTICES(ROWS, COLS, cellSize, wallThickness, wallHeight);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, verts, this.gl.STATIC_DRAW);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
        const indexBuf = this.createBuffer();
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuf);
        this.gl.bufferData(
            this.gl.ELEMENT_ARRAY_BUFFER,
            new Uint8Array([
                1, 2, 7, 1, 7, 4,

                1, 13, 12, 1, 12, 0,

                14, 13, 8, 14, 8, 11,

                5, 9, 8, 5, 8, 4,

                6, 3, 19, 6, 19, 22,

                3, 15, 31, 3, 31, 19,

                15, 10, 26, 15, 26, 31,

                10, 6, 22, 10, 22, 26,
            ]),
            this.gl.STATIC_DRAW
        );
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);

        // Interleaved format: (x, y, z, r, g, b) (all f32)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertexBuf);
        this.gl.vertexAttribPointer(posAttrib, 3, this.gl.FLOAT, false, 6 * Float32Array.BYTES_PER_ELEMENT, 0);
        this.gl.vertexAttribPointer(colorAttrib, 3, this.gl.FLOAT, false, 6 * Float32Array.BYTES_PER_ELEMENT, 3 * Float32Array.BYTES_PER_ELEMENT);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);

        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuf);
        this.gl.bindVertexArray(null);

        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null); // Not sure if necessary, but not a bad idea.

        return vao;
    }
    draw(matWorldUniform, mazeCheckUniform) {
        if (this.mazeData.hasUpdate) this.updateMaze();

        this.gl.uniformMatrix4fv(matWorldUniform, false, this.matWorld);
        this.gl.uniform1i(mazeCheckUniform, 1);
        this.gl.bindVertexArray(this.vao);
        this.gl.drawElements(this.gl.TRIANGLES, this.numInds, this.gl.UNSIGNED_SHORT, 0);
        this.gl.uniform1i(mazeCheckUniform, 0);
        this.gl.bindVertexArray(this.wallVao);
        this.gl.drawElements(this.gl.TRIANGLES, 48, this.gl.UNSIGNED_BYTE, 0);
        this.gl.bindVertexArray(null);
    }
}

Math.TAO = Math.PI * 2;

export function introTo3DDemo(mazeData) {
    const { ROWS, COLS } = mazeData.size;
    const { cellSize, wallThickness, scale } = MazeShape;
    const scaledWall = wallThickness * scale;
    const scaledCell = cellSize * scale;
    const wallToCellRatio = parseFloat((scaledWall / scaledCell).toPrecision(10));
    const halfC = ((COLS * cellSize) / 2) * scale;
    const halfR = ((ROWS * cellSize) / 2) * scale;

    const canvas = document.querySelector("canvas");
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
        showError("Could not get Canvas reference");
        return;
    }

    const gl = getContext(canvas);

    const cubeVertices = createStaticVertexBuffer(gl, CUBE_VERTICES);
    const cubeIndices = createStaticIndexBuffer(gl, CUBE_INDICES);
    const tableVertices = createStaticVertexBuffer(gl, TABLE_VERTICES);
    const tableIndices = createStaticIndexBuffer(gl, TABLE_INDICES);

    if (!cubeVertices || !cubeIndices || !tableVertices || !tableIndices) {
        showError(`Failed to create geo: cube: (v=${!!cubeVertices} i=${cubeIndices}), table=(v=${!!tableVertices} i=${!!tableIndices})`);
        return;
    }

    const demoProgram = createProgram(gl, vertexShaderSourceCode, fragmentShaderSourceCode);
    if (!demoProgram) {
        showError("Failed to compile WebGL program");
        return;
    }

    const posAttrib = gl.getAttribLocation(demoProgram, "vertexPosition");
    const colorAttrib = gl.getAttribLocation(demoProgram, "vertexColor");

    const matWorldUniform = gl.getUniformLocation(demoProgram, "matWorld");
    const matViewProjUniform = gl.getUniformLocation(demoProgram, "matViewProj");
    const cameraPosUniform = gl.getUniformLocation(demoProgram, "cameraPostion");

    const mazeCheckUniform = gl.getUniformLocation(demoProgram, "mazeCheck");

    if (posAttrib < 0 || colorAttrib < 0 || !matWorldUniform || !matViewProjUniform || !mazeCheckUniform) {
        showError(`Failed to get attribs/uniforms: ` + `pos=${posAttrib}, color=${colorAttrib} ` + `matWorld=${!!matWorldUniform} matViewProj=${!!matViewProjUniform} mazeCheckUniform=${!!mazeCheckUniform}`);
        return;
    }

    // const mazeShape = new MazeShape(mazeData);

    const cubeVao = create3dPosColorInterleavedVao(gl, cubeVertices, cubeIndices, posAttrib, colorAttrib);
    const tableVao = create3dPosColorInterleavedVao(gl, tableVertices, tableIndices, posAttrib, colorAttrib);
    const mazeShape = new MazeShape(gl, mazeData, posAttrib, colorAttrib);

    if (!cubeVao || !tableVao) {
        showError(`Failed to create VAOs: cube=${!!cubeVao} table=${!!tableVao}`);
        return;
    }

    const UP_VEC = vec3.fromValues(0, 1, 0);
    const shapes = [
        new Shape(vec3.fromValues(0, 0, 0), [(COLS / 2) * scaledCell, 10, (ROWS / 2) * scaledCell], UP_VEC, 0, tableVao, TABLE_INDICES.length), // Ground
        new Shape(vec3.fromValues(0, 1, 0), [0.5, 1, 0.5], UP_VEC, 0, cubeVao, CUBE_INDICES.length), // Center
        // new Shape(vec3.fromValues(1, 0.05, 1), 0.05, UP_VEC, 0, cubeVao, CUBE_INDICES.length),
        // new Shape(vec3.fromValues(1, 0.1, -1), 0.1, UP_VEC, 0, cubeVao, CUBE_INDICES.length),
        // new Shape(vec3.fromValues(-1, 0.15, 1), 0.15, UP_VEC, 0, cubeVao, CUBE_INDICES.length),
        // new Shape(vec3.fromValues(-1, 0.2, -1), 0.2, UP_VEC, 0, cubeVao, CUBE_INDICES.length),
    ];

    // shapes[1].scaleVec[1] = 1;

    const matView = mat4.create();
    const matProj = mat4.create();
    const matViewProj = mat4.create();
    const lookAtPos = vec3.create(0, 0, 0);

    //
    // Render!
    let lastFrameTime = performance.now();

    // this.pos = [(this.mazeData.size.ROWS * MazeShape.cellSize * MazeShape.scale) / 2, 0, (-this.mazeData.size.COLS * MazeShape.cellSize * MazeShape.scale) / 2];

    const cameraPOS = vec3.fromValues(-(COLS * MazeShape.cellSize * MazeShape.scale) / 2, 1.5, (ROWS * MazeShape.cellSize * MazeShape.scale) / 2);
    cameraPOS[0] += 1;
    cameraPOS[2] -= 1;

    window.pos = cameraPOS;
    window.bruh = [0, 0];
    const cameraRot = [0, 0];

    const maxR = Math.PI / 2; // * 0.95;

    const sensitivity = 0.1;
    let cameraSpeed = 3;
    let zoom = 0;

    canvas.addEventListener("click", (e) => {
        canvas.requestPointerLock({
            // unadjustedMovement: true,
        });
        canvas.onmousemove = (e) => {
            if (document.pointerLockElement != canvas) return;
            cameraRot[0] += glMatrix.toRadian(e.movementX) * sensitivity;
            cameraRot[1] -= glMatrix.toRadian(e.movementY) * sensitivity;

            cameraRot[0] %= Math.TAO;
            while (cameraRot[0] < 0) cameraRot[0] += Math.TAO;
            if (cameraRot[1] < -maxR) cameraRot[1] = -maxR;
            else if (cameraRot[1] > maxR) cameraRot[1] = maxR;
        };
        canvas.onmousewheel = (e) => {
            // cameraSpeed = Math.max(0, cameraSpeed - e.deltaY / 500);
            zoom = Math.max(0, zoom + e.deltaY / 100);
        };
    });

    const pressed = {};

    window.onkeydown = (e) => {
        pressed[e.code] = true;
    };

    window.onkeyup = (e) => {
        delete pressed[e.code];
    };

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);

    let frameCheck = 0,
        average = 0,
        timer = 10,
        lastAvg = 60;

    const isValidCell = (row, col) => {
        return row >= 0 && row < ROWS && col >= 0 && col < COLS;
    };
    const getCell = (row, col, maze) => {
        if (isValidCell(row, col)) return maze[row * COLS + col];
    };

    const canConnectRight = (row, col, maze) => {
        return getCell(row, col, maze) === 1 || getCell(row, col + 1, maze) === 3;
    };

    const canConnectUp = (row, col, maze) => {
        return getCell(row, col, maze) === 0 || getCell(row - 1, col, maze) === 2;
    };
    const transformToMaze = (r, c) => [r / -scaledCell, c / scaledCell];
    const transformToMazeInverse = (r, c) => [r * -scaledCell, c * scaledCell];

    const frame = function () {
        const thisFrameTime = performance.now();
        const dt = (thisFrameTime - lastFrameTime) / 1000;
        lastFrameTime = thisFrameTime;
        const dtSpeed = cameraSpeed * dt;

        average += 1 / dt;

        if (++frameCheck % timer == 0) {
            if (lastAvg != (lastAvg = Math.floor(average / timer))) fps.innerHTML = lastAvg;
            frameCheck = timer;
            average = 0;
        }

        const cosPitch = Math.cos(cameraRot[0]) * dtSpeed;
        const sinPitch = Math.sin(cameraRot[0]) * dtSpeed;

        let moved = false,
            dx = 0,
            dz = 0;

        if (pressed.Space) cameraPOS[1] += dtSpeed;
        if (pressed.ShiftLeft) cameraPOS[1] -= dtSpeed;
        if (pressed.KeyW && !pressed.KeyS) {
            cameraPOS[0] += cosPitch;
            cameraPOS[2] += sinPitch;
            dx += cosPitch;
            dz += sinPitch;
            moved = true;
        }
        if (pressed.KeyA && !pressed.KeyD) {
            cameraPOS[0] += sinPitch;
            cameraPOS[2] -= cosPitch;
            dx += sinPitch;
            dz -= cosPitch;
            moved = true;
        }
        if (pressed.KeyS && !pressed.KeyW) {
            cameraPOS[0] -= cosPitch;
            cameraPOS[2] -= sinPitch;
            dx -= cosPitch;
            dz -= sinPitch;
            moved = true;
        }
        if (pressed.KeyD && !pressed.KeyA) {
            cameraPOS[0] -= sinPitch;
            cameraPOS[2] += cosPitch;
            dx -= sinPitch;
            dz += cosPitch;
            moved = true;
        }

        // Collision checks
        if (moved) {
            const { maze } = mazeData;

            const [curRow, curCol] = [cameraPOS[2] - halfR, cameraPOS[0] + halfC];
            mazeData.setPos(([...bruh] = transformToMaze(curRow, curCol).map(Math.floor)));

            const wallRed = !canConnectUp(bruh[0], bruh[1], maze);
            const wallBlue = !canConnectRight(bruh[0], bruh[1], maze);
            const wallCyan = !canConnectUp(bruh[0] + 1, bruh[1], maze);
            const wallYellow = !canConnectRight(bruh[0], bruh[1] - 1, maze);

            let [red, blue] = transformToMaze(curRow + 0.5, curCol + 0.5);
            let [cyan, yellow] = transformToMaze(curRow - 0.5, curCol - 0.5);

            // const blueInThisWall = blue - bruh[1] < 1 && parseFloat((blue - bruh[1]).toPrecision(5)) > 1 - wallToCellRatio;
            // const blueInNextWall = blue - bruh[1] > 1 && parseFloat((blue - bruh[1] - 1).toPrecision(5)) < wallToCellRatio;
            // const redInThisWall = red - bruh[0] > 0 && parseFloat((red - bruh[0]).toPrecision(5)) < wallToCellRatio;
            // const redInNextWall = red - bruh[0] < 0 && parseFloat((red - bruh[0] + 1).toPrecision(5)) > 1 - wallToCellRatio;
            // const yellowInThisWall = yellow - bruh[1] > 0 && parseFloat((yellow - bruh[1]).toPrecision(5)) < wallToCellRatio;
            // const yellowInNextWall = yellow - bruh[1] < 0 && parseFloat((yellow - bruh[1] + 1).toPrecision(5)) > 1 - wallToCellRatio;
            // const cyanInThisWall = cyan - bruh[0] < 1 && parseFloat((cyan - bruh[0]).toPrecision(5)) > 1 - wallToCellRatio;
            // const cyanInNextWall = cyan - bruh[0] > 1 && parseFloat((cyan - bruh[0] - 1).toPrecision(5)) < wallToCellRatio;

            // const blueInWall = blueInThisWall || blueInNextWall;
            // const redInWall = redInThisWall || redInNextWall;
            // const yellowInWall = yellowInThisWall || yellowInNextWall;
            // const cyanInWall = cyanInThisWall || cyanInNextWall;

            const getCollisions = (red, blue, cyan, yellow) => {
                const blueInThisWall = blue - bruh[1] < 1 && parseFloat((blue - bruh[1]).toPrecision(5)) > 1 - wallToCellRatio;
                const blueInNextWall = blue - bruh[1] > 1 && parseFloat((blue - bruh[1] - 1).toPrecision(5)) < wallToCellRatio;
                const redInThisWall = red - bruh[0] > 0 && parseFloat((red - bruh[0]).toPrecision(5)) < wallToCellRatio;
                const redInNextWall = red - bruh[0] < 0 && parseFloat((red - bruh[0] + 1).toPrecision(5)) > 1 - wallToCellRatio;
                const yellowInThisWall = yellow - bruh[1] > 0 && parseFloat((yellow - bruh[1]).toPrecision(5)) < wallToCellRatio;
                const yellowInNextWall = yellow - bruh[1] < 0 && parseFloat((yellow - bruh[1] + 1).toPrecision(5)) > 1 - wallToCellRatio;
                const cyanInThisWall = cyan - bruh[0] < 1 && parseFloat((cyan - bruh[0]).toPrecision(5)) > 1 - wallToCellRatio;
                const cyanInNextWall = cyan - bruh[0] > 1 && parseFloat((cyan - bruh[0] - 1).toPrecision(5)) < wallToCellRatio;

                const blueInWall = blueInThisWall || blueInNextWall;
                const redInWall = redInThisWall || redInNextWall;
                const yellowInWall = yellowInThisWall || yellowInNextWall;
                const cyanInWall = cyanInThisWall || cyanInNextWall;
                const blueIsYellow = Math.floor(blue) == Math.floor(yellow);
                const redIsCyan = Math.floor(red) == Math.floor(cyan);

                const blueCollision = blueInWall && (!canConnectRight(bruh[0], bruh[1], maze) || redInWall || cyanInWall || !redIsCyan);
                const redCollision = redInWall && (!canConnectUp(bruh[0], bruh[1], maze) || blueInWall || yellowInWall || !blueIsYellow);
                const yellowCollision = yellowInWall && (!canConnectRight(bruh[0], bruh[1] - 1, maze) || redInWall || cyanInWall || !redIsCyan);
                const cyanCollision = cyanInWall && (!canConnectUp(bruh[0] + 1, bruh[1], maze) || blueInWall || yellowInWall || !blueIsYellow);
                return { blueCollision, redCollision, yellowCollision, cyanCollision };
            };

            let { blueCollision, redCollision, yellowCollision, cyanCollision } = getCollisions(red, blue, cyan, yellow);

            const [tdz, tdx] = transformToMaze(dz, dx);
            const [redC, blueC] = transformToMazeInverse(red - bruh[0] - wallToCellRatio, blue - bruh[1] - 1 + wallToCellRatio);
            const [cyanC, yellowC] = transformToMazeInverse(cyan - bruh[0] - 1 + wallToCellRatio, yellow - bruh[1] - wallToCellRatio);

            let prioritizeCols;

            const xWall = tdx < 0 ? wallYellow : wallBlue;
            const zWall = tdz < 0 ? wallRed : wallCyan;

            if (xWall && !zWall) prioritizeCols = true;
            else if (!xWall && zWall) prioritizeCols = false;
            else prioritizeCols = Math.abs(tdx < 0 ? yellowC : blueC) < Math.abs(tdz < 0 ? redC : cyanC);

            // console.log(
            //     prioritizeCols, Math.sign(tdz), xWall, zWall,
            //     bruh,
            //     { wallBlue, wallRed, wallYellow, wallCyan },
            //     { blueCollision, redCollision, yellowCollision, cyanCollision },
            //     { blueInWall, redInWall, yellowInWall, cyanInWall },
            // );

            if (prioritizeCols) {
                if (tdx > 0) {
                    if (blueCollision) {
                        const snapback = blue - bruh[1] - 1 + wallToCellRatio;
                        blue -= snapback;
                        cameraPOS[0] -= snapback * scaledCell;
                        ({ redCollision, cyanCollision } = getCollisions(red, blue, cyan, yellow));
                    }
                } else if (yellowCollision) {
                    const snapback = yellow - bruh[1] - wallToCellRatio;
                    yellow -= snapback;
                    cameraPOS[0] -= snapback * scaledCell;
                    ({ redCollision, cyanCollision } = getCollisions(red, blue, cyan, yellow));
                }
                if (tdz > 0) cyanCollision && (cameraPOS[2] += (cyan - bruh[0] - 1 + wallToCellRatio) * scaledCell);
                else redCollision && (cameraPOS[2] += (red - bruh[0] - wallToCellRatio) * scaledCell);
            } else {
                if (tdz > 0) {
                    if (cyanCollision) {
                        const snapback = cyan - bruh[0] - 1 + wallToCellRatio;
                        cyan -= snapback;
                        cameraPOS[2] += snapback * scaledCell;
                        ({ blueCollision, yellowCollision } = getCollisions(red, blue, cyan, yellow));
                    }
                } else if (redCollision) {
                    const snapback = red - bruh[0] - wallToCellRatio;
                    red -= snapback;
                    cameraPOS[2] += snapback * scaledCell;
                    ({ blueCollision, yellowCollision } = getCollisions(red, blue, cyan, yellow));
                }
                if (tdx > 0) blueCollision && (cameraPOS[0] -= (blue - bruh[1] - 1 + wallToCellRatio) * scaledCell);
                else yellowCollision && (cameraPOS[0] -= (yellow - bruh[1] - wallToCellRatio) * scaledCell);
            }
        }

        //
        // Update

        shapes[1].pos[0] = cameraPOS[0];
        shapes[1].pos[2] = cameraPOS[2];

        const cosY = Math.cos(cameraRot[1]);
        const cameraVec = vec3.fromValues(Math.cos(cameraRot[0]) * cosY, Math.sin(cameraRot[1]), Math.sin(cameraRot[0]) * cosY);

        vec3.add(lookAtPos, cameraPOS, cameraVec);

        // lookat(matView, /* pos= */ cameraPOS, /* lookAt= */ lookAtPos, /* up= */ vec3.fromValues(0, 1, 0), cameraRot[0]);

        const up = cameraPOS[0] != lookAtPos[0] || cameraPOS[2] != lookAtPos[2] ? vec3.fromValues(0, 1, 0) : vec3.scale([], [Math.cos(cameraRot[0]), 0, Math.sin(cameraRot[0])], cameraPOS[1] < lookAtPos[1] ? -1 : 1);
        mat4.lookAt(matView, /* pos= */ cameraPOS, /* lookAt= */ lookAtPos, /* up= */ up);

        mat4.translate(matView, matView, vec3.scale([], cameraVec, zoom));

        mat4.perspective(matProj, /* fovy= */ glMatrix.toRadian(90), /* aspectRatio= */ canvas.width / canvas.height, /* near, far= */ 0.1, 100.0);

        // in GLM:    matViewProj = matProj * matView
        mat4.multiply(matViewProj, matProj, matView);

        //
        // Render
        canvas.width = innerWidth;
        canvas.height = innerHeight;

        gl.clearColor(0.02, 0.02, 0.02, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.viewport(0, 0, canvas.width, canvas.height);

        gl.useProgram(demoProgram);
        gl.uniformMatrix4fv(matViewProjUniform, false, matViewProj);
        gl.uniform1i(mazeCheckUniform, 0);

        shapes.forEach((shape) => shape.draw(gl, matWorldUniform));

        // shapes[1].rotationAngle += 0.02
        mazeShape.draw(matWorldUniform, mazeCheckUniform);
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}
