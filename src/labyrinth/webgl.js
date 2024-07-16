import { CUBE_INDICES, CUBE_VERTICES, TABLE_INDICES, TABLE_VERTICES, WALL_VERTICES, create3dPosColorInterleavedVao } from "./geometry.js";
import { createProgram, createStaticIndexBuffer, createStaticVertexBuffer, getContext, showError } from "./utils.js";
const { glMatrix, mat4, quat, vec3, vec2 } = window.glMatrix;

let crosshair = document.querySelector("#maze");
crosshair.id = "";
crosshair.className = "crosshair";

const canvas = document.querySelector("canvas");
canvas.style = "";
canvas.width = innerWidth;
canvas.height = innerHeight;

const fps = document.createElement("div");
fps.style = `position: absolute; top: 0; left: 0; color: white; mix-blend-mode: difference`;
document.body.append(fps);

const vertexShaderSourceCode = await fetch("src/labyrinth/shaders/vertex.glsl").then((x) => x.text());
const fragmentShaderSourceCode = await fetch("src/labyrinth/shaders/fragment.glsl").then((x) => x.text());

const rounded = (x) => parseFloat(x.toPrecision(5));
const roundCompare = (x, y) => Math.abs(x - y) <= 0.00001;
const expDecay = (a, b, decay, dt) => (roundCompare(a, b) ? b : b + (a - b) * Math.exp(-decay * dt));

class Shape {
    matWorld = mat4.create();
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

    static cellSize = 1.5;
    static wallThickness = 0.1;
    static wallHeight = 1;

    static scaledCell = MazeShape.scale * MazeShape.cellSize;
    static wallToCellRatio = parseFloat((MazeShape.wallThickness / MazeShape.cellSize).toPrecision(10));

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
    static transformToMaze = (r, c) => [r / -MazeShape.scaledCell, c / MazeShape.scaledCell];
    static transformToMazeInverse = (r, c) => [r * -MazeShape.scaledCell, c * MazeShape.scaledCell];
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
        this.indicies = new Uint16Array(ROWS * COLS * 12 * 2);
        this.stretchArr = new Array(COLS);
        window.addEventListener("keydown", (e) => e.code == "KeyG" && this.initMaze());
        this.initMaze();

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
    }
    findInd(first, last) {
        let i;
        for (i = 0; i < this.indicies.length && this.indicies[i] != this.indicies[i + 1]; i += 6) if (this.indicies[i] == first && this.indicies[i + 3] == first && this.indicies[i + 5] == last) return i;
        return i;
    }
    findInd2(first, second) {
        let i;
        for (i = 0; i < this.indicies.length && this.indicies[i] != this.indicies[i + 1]; i += 6) if (this.indicies[i] == first && this.indicies[i + 3] == first && this.indicies[i + 1] == second) return i;
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
    draw(gl, matWorldUniform, mazeCheckUniform) {
        if (this.mazeData.hasUpdate) this.updateMaze();
        // if (this.mazeData.hasUpdate) this.initMaze();

        gl.uniformMatrix4fv(matWorldUniform, false, this.matWorld);
        gl.uniform1i(mazeCheckUniform, 1);
        gl.bindVertexArray(this.vao);
        gl.drawElements(gl.TRIANGLES, this.numInds, gl.UNSIGNED_SHORT, 0);
        gl.uniform1i(mazeCheckUniform, 0);
        gl.bindVertexArray(this.wallVao);
        gl.drawElements(gl.TRIANGLES, 48, gl.UNSIGNED_BYTE, 0);
        gl.bindVertexArray(null);
    }
}

class PlayerController {
    static NORMAL_FOV = 90;
    static SPRINT_FOV = 110;
    static FOV_DECAY = 10;
    static SPRINT_MULTIPLIER = 2;
    static HEIGHT_REGEX = /^(\d+)'(\d+(?:.\d+)?)"$/;
    static MAX_RAW = Math.PI / 2;

    static FOV_EFFECTS_ENABLED = true;

    fovValue = PlayerController.NORMAL_FOV;
    rawFov = PlayerController.NORMAL_FOV;
    curPos = [0, 0];
    sensitivity = 0.1;
    cameraSpeed = 3;
    zoom = 0;
    pressed = Object.create(null);

    constructor(mazeData, canvas, shape) {
        const { ROWS, COLS } = (this.mazeData = mazeData).size;
        const { cellSize, scale, wallThickness, scaledCell } = MazeShape;

        this.shape = shape;

        this.height = "5'6\"" || prompt(`How tall are you? Ex: 5'6"`);
        let heightMatch;
        while ((heightMatch = this.height.match(PlayerController.HEIGHT_REGEX)) == null) this.height = prompt(`How tall are you? Ex: 5'6"\n\nInvalid Input`);
        const inches = Math.min(72, Math.max(0, parseInt(heightMatch[1]) * 12 + parseFloat(heightMatch[2])));
        this.eyeLevel = Math.pow(1.09, inches) / 200;
        this.cubeHeight = (this.eyeLevel * 2) / 3;

        this.cameraPOS = vec3.fromValues(((1 - COLS) * scaledCell) / 2, this.eyeLevel, ((ROWS - 1) * scaledCell) / 2);
        shape.pos[0] = this.cameraPOS[0];
        shape.pos[2] = this.cameraPOS[2];
        this.cameraRot = vec2.fromValues(0, 0);
        Math.TAU ??= Math.PI * 2;

        canvas.addEventListener("click", (e) => {
            canvas.requestPointerLock();
            canvas.onmousemove = (e) => {
                if (document.pointerLockElement != canvas) return;
                const zoomSensitivity = this.sensitivity / (this.zoom <= 0 || !PlayerController.FOV_EFFECTS_ENABLED ? 1 : this.zoom / 22.5);
                this.cameraRot[0] += glMatrix.toRadian(e.movementX) * zoomSensitivity;
                this.cameraRot[1] -= glMatrix.toRadian(e.movementY) * zoomSensitivity;

                this.cameraRot[0] %= Math.TAU;
                while (this.cameraRot[0] < 0) this.cameraRot[0] += Math.TAU;
                if (this.cameraRot[1] < -PlayerController.MAX_RAW) this.cameraRot[1] = -PlayerController.MAX_RAW;
                else if (this.cameraRot[1] > PlayerController.MAX_RAW) this.cameraRot[1] = PlayerController.MAX_RAW;
            };
            canvas.onmousewheel = (e) => {
                this.zoom = Math.max(0, Math.min(85, this.zoom - (e.deltaY / 100) * 7));
            };
        });

        window.onkeydown = (e) => {
            if (e.code == "KeyC" && !this.pressed.KeyC) this.zoom = 50;
            this.pressed[e.code] = true;
        };

        window.onkeyup = (e) => {
            this.pressed[e.code] = false;
        };
    }
    getCollisions([row, col], maze, red, blue, cyan, yellow) {
        const { wallToCellRatio } = MazeShape;
        const { canConnectRight, canConnectUp } = this.mazeData;
        const bluePos = parseFloat((blue - col).toPrecision(10));
        const redPos = parseFloat((red - row).toPrecision(10));
        const yellowPos = parseFloat((yellow - col).toPrecision(10));
        const cyanPos = parseFloat((cyan - row).toPrecision(10));

        const blueInWall = bluePos > 1 - wallToCellRatio;
        const redInWall = redPos < wallToCellRatio;
        const yellowInWall = yellowPos < wallToCellRatio;
        const cyanInWall = cyanPos > 1 - wallToCellRatio;
        const blueIsNotYellow = Math.floor(blue) != Math.floor(yellow);
        const redIsNotCyan = Math.floor(red) != Math.floor(cyan);

        const blueCollision = blueInWall && (!canConnectRight(row, col, maze) || redInWall || cyanInWall || redIsNotCyan);
        const redCollision = redInWall && (!canConnectUp(row, col, maze) || blueInWall || yellowInWall || blueIsNotYellow);
        const yellowCollision = yellowInWall && (!canConnectRight(row, col - 1, maze) || redInWall || cyanInWall || redIsNotCyan);
        const cyanCollision = cyanInWall && (!canConnectUp(row + 1, col, maze) || blueInWall || yellowInWall || blueIsNotYellow);
        return { blueCollision, redCollision, yellowCollision, cyanCollision };
    }
    update(dt) {
        const { cellSize, scaledCell, wallToCellRatio, transformToMaze, transformToMazeInverse } = MazeShape;
        let speed = this.cameraSpeed * dt;
        const sprinting = this.pressed.ShiftLeft || this.pressed.ShiftRight;

        if (sprinting) speed *= 2;

        const cosPitch = Math.cos(this.cameraRot[0]) * speed;
        const sinPitch = Math.sin(this.cameraRot[0]) * speed;

        let dx = 0,
            dz = 0;

        // if (this.pressed.Space) {
        //     this.cameraPOS[1] += speed;
        // }

        // if (this.pressed.ControlLeft) {
        //     this.cameraPOS[1] -= speed;
        // }

        if (this.pressed.KeyW && !this.pressed.KeyS) {
            dx += cosPitch;
            dz += sinPitch;
        }
        if (this.pressed.KeyA && !this.pressed.KeyD) {
            dx += sinPitch;
            dz -= cosPitch;
        }
        if (this.pressed.KeyS && !this.pressed.KeyW) {
            dx -= cosPitch;
            dz -= sinPitch;
        }
        if (this.pressed.KeyD && !this.pressed.KeyA) {
            dx -= sinPitch;
            dz += cosPitch;
        }
        if (!this.pressed.KeyC && this.zoom != 0) this.zoom = 0;

        const moved = dx != 0 || dz != 0;

        const curFov = (sprinting && moved ? PlayerController.SPRINT_FOV : PlayerController.NORMAL_FOV) - this.zoom;
        if (this.rawFov != curFov) this.rawFov = expDecay(this.rawFov, curFov, PlayerController.FOV_DECAY, dt);

        this.fovValue = this.rawFov;

        if (moved) {
            const {
                maze,
                size: { ROWS, COLS },
                canConnectRight,
                canConnectUp,
            } = this.mazeData;
            const [tdz, tdx] = transformToMaze(dz, dx);

            const curRow = this.cameraPOS[2] - (ROWS * scaledCell) / 2;
            const curCol = this.cameraPOS[0] + (COLS * scaledCell) / 2;

            const curPos = transformToMaze(curRow, curCol).map(Math.floor);
            this.mazeData.setPos(curPos);

            const wallRed = !canConnectUp(curPos[0], curPos[1], maze);
            const wallBlue = !canConnectRight(curPos[0], curPos[1], maze);
            const wallCyan = !canConnectUp(curPos[0] + 1, curPos[1], maze);
            const wallYellow = !canConnectRight(curPos[0], curPos[1] - 1, maze);

            let [red, blue] = transformToMaze(curRow + dz + 0.5, curCol + dx + 0.5);
            let [cyan, yellow] = transformToMaze(curRow + dz - 0.5, curCol + dx - 0.5);

            const [redDist, blueDist] = transformToMazeInverse(red - curPos[0] - wallToCellRatio, blue - curPos[1] - 1 + wallToCellRatio);
            const [cyanDist, yellowDist] = transformToMazeInverse(cyan - curPos[0] - 1 + wallToCellRatio, yellow - curPos[1] - wallToCellRatio);

            let { blueCollision, redCollision, yellowCollision, cyanCollision } = this.getCollisions(curPos, maze, red, blue, cyan, yellow);

            const xWall = tdx < 0 ? wallYellow : wallBlue;
            const zWall = tdz < 0 ? wallRed : wallCyan;

            let prioritizeCols = Math.abs(tdx < 0 ? yellowDist : blueDist) < Math.abs(tdz < 0 ? redDist : cyanDist);
            if (xWall != zWall) prioritizeCols = xWall;

            if (prioritizeCols) {
                if (tdx > 0) {
                    if (blueCollision) {
                        const snapback = blue - curPos[1] - 1 + wallToCellRatio;
                        blue -= snapback;
                        dx -= snapback * scaledCell;
                        ({ redCollision, cyanCollision } = this.getCollisions(curPos, maze, red, blue, cyan, yellow));
                    }
                } else if (yellowCollision) {
                    const snapback = yellow - curPos[1] - wallToCellRatio;
                    yellow -= snapback;
                    dx -= snapback * scaledCell;
                    ({ redCollision, cyanCollision } = this.getCollisions(curPos, maze, red, blue, cyan, yellow));
                }
                if (tdz > 0) cyanCollision && (dz += (cyan - curPos[0] - 1 + wallToCellRatio) * scaledCell);
                else redCollision && (dz += (red - curPos[0] - wallToCellRatio) * scaledCell);
            } else {
                if (tdz > 0) {
                    if (cyanCollision) {
                        const snapback = cyan - curPos[0] - 1 + wallToCellRatio;
                        cyan -= snapback;
                        dz += snapback * scaledCell;
                        ({ blueCollision, yellowCollision } = this.getCollisions(curPos, maze, red, blue, cyan, yellow));
                    }
                } else if (redCollision) {
                    const snapback = red - curPos[0] - wallToCellRatio;
                    red -= snapback;
                    dz += snapback * scaledCell;
                    ({ blueCollision, yellowCollision } = this.getCollisions(curPos, maze, red, blue, cyan, yellow));
                }
                if (tdx > 0) blueCollision && (dx -= (blue - curPos[1] - 1 + wallToCellRatio) * scaledCell);
                else yellowCollision && (dx -= (yellow - curPos[1] - wallToCellRatio) * scaledCell);
            }

            this.shape.pos[0] = this.cameraPOS[0] += dx;
            this.shape.pos[2] = this.cameraPOS[2] += dz;

            // shapes[1].pos[0] = cameraPOS[0];
            // shapes[1].pos[2] = cameraPOS[2];
        }
    }
}

window.MAX_FRAMERATE = 60;

window.requestAnimationFrame = (() => {
    let lastTime = performance.now();
    return function (callback, maxFrameRate = MAX_FRAMERATE) {
        const curTime = performance.now();
        const timeBetween = !isNaN(maxFrameRate) && isFinite(maxFrameRate) && maxFrameRate > 0 ? 1000 / maxFrameRate : 0;
        const timeToCall = Math.max(0, timeBetween - (curTime - lastTime));
        const id = window.setTimeout(callback, Math.round(timeToCall), curTime + timeToCall);
        lastTime = curTime + timeToCall;
        return id;
    };
})();

window.cancelAnimationFrame = (id) => clearTimeout(id);

export function introTo3DDemo(mazeData) {
    const {
        canConnectRight,
        canConnectUp,
        size: { ROWS, COLS },
    } = mazeData;
    const { cellSize, wallThickness, scale, transformToMaze, transformToMazeInverse } = MazeShape;
    const scaledWall = wallThickness * scale;
    const scaledCell = cellSize * scale;
    const wallToCellRatio = parseFloat((scaledWall / scaledCell).toPrecision(10));
    const halfC = (COLS * scaledCell) / 2;
    const halfR = (ROWS * scaledCell) / 2;

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

    let height = "5'6\"" || prompt(`How tall are you? Ex: 5'6"`);
    const heightRegex = /^(\d+)'(\d+)"$/;
    let heightMatch;
    while ((heightMatch = height.match(heightRegex)) == null) height = prompt(`How tall are you? Ex: 5'6"\n\nInvalid Input`);
    const inches = Math.min(72, Math.max(0, parseInt(heightMatch[1]) * 12 + parseInt(heightMatch[2])));
    const eyeLevel = Math.pow(1.09, inches) / 200;
    const cubeHeight = (eyeLevel * 2) / 3;

    const UP_VEC = vec3.fromValues(0, 1, 0);

    const player = new PlayerController(mazeData, canvas, new Shape(vec3.fromValues(0, cubeHeight, 0), [0.5, cubeHeight, 0.5], UP_VEC, 0, cubeVao, CUBE_INDICES.length));

    const shapes = [
        new Shape(vec3.fromValues(0, 0, 0), [(COLS / 2) * scaledCell, 10, (ROWS / 2) * scaledCell], UP_VEC, 0, tableVao, TABLE_INDICES.length), // Ground
        player.shape,
        mazeShape,
    ];

    const matView = mat4.create();
    const matProj = mat4.create();
    const matViewProj = mat4.create();
    const lookAtPos = vec3.create(0, 0, 0);

    // Render
    let lastFrameTime = performance.now();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);

    let frameCheckFreq = 10,
        average = 0,
        framesAdded = 0,
        lastAvg = 60;

    setInterval(() => {
        if (lastAvg != (lastAvg = Math.floor(average / framesAdded))) fps.innerHTML = lastAvg;
        framesAdded = average = 0;
    }, 1000 / frameCheckFreq);

    const frame = function () {
        const thisFrameTime = performance.now();
        const dt = (thisFrameTime - lastFrameTime) / 1000;
        lastFrameTime = thisFrameTime;

        average += 1 / dt;
        framesAdded++;

        // Update

        player.update(dt);

        const { cameraPOS, cameraRot, fovValue } = player;

        const cosY = Math.cos(cameraRot[1]);
        const cameraVec = vec3.fromValues(Math.cos(cameraRot[0]) * cosY, Math.sin(cameraRot[1]), Math.sin(cameraRot[0]) * cosY);

        vec3.add(lookAtPos, cameraPOS, cameraVec);

        const up = roundCompare(cameraPOS[0], lookAtPos[0]) && roundCompare(cameraPOS[2], lookAtPos[2]) ? vec3.scale([], [Math.cos(cameraRot[0]), 0, Math.sin(cameraRot[0])], cameraPOS[1] < lookAtPos[1] ? -1 : 1) : vec3.fromValues(0, 1, 0);
        mat4.lookAt(matView, /* pos= */ cameraPOS, /* lookAt= */ lookAtPos, /* up= */ up);

        // mat4.translate(matView, matView, vec3.scale([], cameraVec, player.zoom * 2));

        mat4.perspective(matProj, /* fovy= */ glMatrix.toRadian(PlayerController.FOV_EFFECTS_ENABLED ? fovValue : 90), /* aspectRatio= */ canvas.width / canvas.height, /* near, far= */ 0.1, 100.0);

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

        shapes.forEach((shape) => shape.draw(gl, matWorldUniform, mazeCheckUniform));

        // shapes[1].rotationAngle += 0.02
        // mazeShape.draw(gl, matWorldUniform, mazeCheckUniform);
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}
