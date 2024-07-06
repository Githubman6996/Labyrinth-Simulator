import { CUBE_INDICES, CUBE_VERTICES, TABLE_INDICES, TABLE_VERTICES, create3dPosColorInterleavedVao } from "./geometry.js";
import { createProgram, createStaticIndexBuffer, createStaticVertexBuffer, getContext, showError } from "./utils.js";
const { glMatrix, mat4, quat, vec3 } = window.glMatrix;

const lookat = (() => {
    return function lookat(out, pos, target, up, rot) {
        if (pos[0] != target[0] || pos[2] != target[2]) return mat4.lookAt(out, pos, target, up);

        return mat4.lookAt(out, pos, target, vec3.scale([], [Math.cos(rot), 0, Math.sin(rot)], pos[1] < target[1] ? -1 : 1));
    };
})();

document.querySelector("#maze").remove();

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
    scaleVec = vec3.create();
    rotation = quat.create();

    constructor(pos, scale, rotationAxis, rotationAngle, vao, numIndices) {
        this.pos = pos;
        this.scale = scale;
        this.rotationAxis = rotationAxis;
        this.rotationAngle = rotationAngle;
        this.vao = vao;
        this.numIndices = numIndices;
    }

    draw(gl, matWorldUniform) {
        quat.setAxisAngle(this.rotation, this.rotationAxis, this.rotationAngle);
        vec3.set(this.scaleVec, this.scale, this.scale, this.scale);

        mat4.fromRotationTranslationScale(this.matWorld, /* rotation= */ this.rotation, /* position= */ this.pos, /* scale= */ this.scaleVec);

        gl.uniformMatrix4fv(matWorldUniform, false, this.matWorld);
        gl.bindVertexArray(this.vao);
        gl.drawElements(gl.TRIANGLES, this.numIndices, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(null);
    }
}

class MazeShape {
    static scale = 1;
    static rotationAxis = [0, 1, 0];
    static rotationAngle = -Math.PI / 2;

    static cellSize = 2;
    static wallThickness = 0.2;

    vertexBuf;
    indexBuf;
    gl;
    vao;

    matWorld = mat4.create();
    scaleVec = vec3.create();
    rotation = quat.create();

    pos = [0, 0, 0];

    verticies;
    indicies; // = new Uint16Array([0, 1, 2, 0, 2, 3]);
    numInds = 6;
    lastMaze;
    curMaze;
    constructor(gl, mazeData, posAttrib) {
        this.mazeData = mazeData;
        this.gl = gl;
        this.vertexBuf = this.createBuffer();
        this.indexBuf = this.createBuffer();
        this.vao = this.createMazeVao(posAttrib);

        this.curMaze = mazeData.maze;

        const verts = [];
        const { ROWS, COLS } = this.mazeData.size;
        const { cellSize, wallThickness } = MazeShape;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const cellPos = [c * cellSize, -r * cellSize];
                verts.push(cellPos[0] + wallThickness, 1, cellPos[1] - wallThickness);
                verts.push(cellPos[0] + cellSize - wallThickness, 1, cellPos[1] - wallThickness);
                verts.push(cellPos[0] + cellSize - wallThickness, 1, cellPos[1] - cellSize + wallThickness);
                verts.push(cellPos[0] + wallThickness, 1, cellPos[1] - cellSize + wallThickness);
            }
        }
        this.verticies = new Float32Array(verts);
        this.updateVertexBuffer();
        console.log((window.mazeShape = this));
        console.log(this.verticies);
        this.indicies = new Uint16Array(ROWS * COLS * 6);
        this.rowCache = new Uint16Array(ROWS);
        this.initMaze();
    }
    isOrigin(row, col) {
        const o = this.mazeData.origin;
        return row == o[0] && col == o[1];
    }
    getCell(row, col, maze) {
        if (row >= 0 && row < this.mazeData.size.ROWS && col >= 0 && col < this.mazeData.size.COLS) return (maze || this.mazeData.maze)[row * this.mazeData.size.COLS + col];
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
        for (let r = 0; r < ROWS; r++) {
            let stretch;
            for (let c = 0; c < COLS; c++) {
                // if (this.isOrigin(r, c)) continue;
                if (this.canConnectUp(r, c)) {
                    const up = ((r - 1) * COLS + c) * 4;
                    const down = (r * COLS + c) * 4;
                    this.addInd(up + 3);
                    this.addInd(up + 2);
                    this.addInd(down + 1);
                    this.addInd(up + 3);
                    this.addInd(down + 1);
                    this.addInd(down);
                }
                if (c <= stretch) continue;
                stretch = c;
                while (this.canConnectRight(r, stretch)) stretch++;
                const first = (r * COLS + c) * 4;
                const third = (r * COLS + stretch) * 4 + 2;
                this.addInd(first);
                this.addInd((r * COLS + stretch) * 4 + 1);
                this.addInd(third);
                this.addInd(first);
                this.addInd(third);
                this.addInd((r * COLS + c) * 4 + 3);
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
    updateMaze() {
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
        const trashInds = [];
        for (let r = Math.max(0, origin[0] - 3); r < Math.min(ROWS, origin[0] + 3); r++) {
            let stretch;
            for (let c = Math.max(0, origin[1] - 3); c < Math.min(COLS, origin[1] + 3); c++) {
                const canUp = this.canConnectUp(r, c);
                const couldUp = this.canConnectUp(r, c, this.lastMaze);
                if (canUp != couldUp) {
                    const up = ((r - 1) * COLS + c) * 4;
                    const down = (r * COLS + c) * 4;
                    if (couldUp) trashInds.push(this.findInd(up + 3, down));
                    else faces.push(up + 3, up + 2, down + 1, up + 3, down + 1, down);
                }
                const canRight = this.canConnectRight(r, c);
                const couldRight = this.canConnectRight(r, c, this.lastMaze);
                if (canRight != couldRight) {
                    let leftC = c - 1;
                    while (this.canConnectRight(r, leftC)) leftC--;
                    leftC++;
                    let left = (r * COLS + leftC) * 4;
                    let right = (r * COLS + c) * 4;
                    trashInds.push(this.findInd(left, left + 3)); // remove left or whole row

                    if (canRight) {
                        left = (r * COLS + c + 1) * 4;
                        trashInds.push(this.findInd(left, left + 3)); // remove right
                        stretch = leftC;
                        while (this.canConnectRight(r, stretch)) stretch++;
                        left = (r * COLS + leftC) * 4;
                        right = (r * COLS + stretch) * 4;
                        faces.push(left, right + 1, right + 2, left, right + 2, left + 3); // add whole
                    } else {
                        faces.push(left, right + 1, right + 2, left, right + 2, left + 3); // add left
                        stretch = c + 1;
                        while (this.canConnectRight(r, stretch)) stretch++;
                        left = (r * COLS + c + 1) * 4;
                        right = (r * COLS + stretch) * 4;
                        faces.push(left, right + 1, right + 2, left, right + 2, left + 3); // add right
                    }
                }
            }
        }
        let i = 0,
            k = 0;

        let oldNum = this.numInds;

        trashInds.sort((a, b) => a - b);

        for (const ind of trashInds) {
            this.indicies[ind] = 0;
            this.indicies[ind + 1] = 0;
            this.indicies[ind + 2] = 0;
            this.indicies[ind + 3] = 0;
            this.indicies[ind + 4] = 0;
            this.indicies[ind + 5] = 0;
        }
        while (i < trashInds.length && k < faces.length) {
            const ind = trashInds[i++];
            this.indicies[ind] = faces[k++];
            this.indicies[ind + 1] = faces[k++];
            this.indicies[ind + 2] = faces[k++];
            this.indicies[ind + 3] = faces[k++];
            this.indicies[ind + 4] = faces[k++];
            this.indicies[ind + 5] = faces[k++];
            // console.log(`Replaced ${ind}`);
        }
        while (k < faces.length) {
            this.addInd(faces[k++]);
            this.addInd(faces[k++]);
            this.addInd(faces[k++]);
            this.addInd(faces[k++]);
            this.addInd(faces[k++]);
            this.addInd(faces[k++]);
        }
        if (i < trashInds.length) {
            let cur = trashInds[i];
            let next = cur;
            const temp = [0, 0, 0, 0, 0, 0];
            while (next < this.numInds) {
                if (this.indicies[next] != 0 || this.indicies[next + 1] != 0) {
                    temp[0] = this.indicies[cur];
                    temp[1] = this.indicies[cur + 1];
                    temp[2] = this.indicies[cur + 2];
                    temp[3] = this.indicies[cur + 3];
                    temp[4] = this.indicies[cur + 4];
                    temp[5] = this.indicies[cur + 5];
                    this.indicies[cur] = this.indicies[next];
                    this.indicies[cur + 1] = this.indicies[next + 1];
                    this.indicies[cur + 2] = this.indicies[next + 2];
                    this.indicies[cur + 3] = this.indicies[next + 3];
                    this.indicies[cur + 4] = this.indicies[next + 4];
                    this.indicies[cur + 5] = this.indicies[next + 5];
                    this.indicies[next] = temp[0];
                    this.indicies[next + 1] = temp[1];
                    this.indicies[next + 2] = temp[2];
                    this.indicies[next + 3] = temp[3];
                    this.indicies[next + 4] = temp[4];
                    this.indicies[next + 5] = temp[5];
                    cur += 6;
                }
                next += 6;
            }
            this.numInds = cur;
        }
        // console.log(trashInds.length, faces.length / 6, oldNum + faces.length - trashInds.length * 6, this.numInds);
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
    draw(matWorldUniform) {
        if (this.mazeData.hasUpdate) this.updateMaze();
        quat.setAxisAngle(this.rotation, MazeShape.rotationAxis, MazeShape.rotationAngle);
        vec3.set(this.scaleVec, MazeShape.scale, MazeShape.scale, MazeShape.scale);

        mat4.fromRotationTranslationScale(this.matWorld, /* rotation= */ this.rotation, /* position= */ this.pos, /* scale= */ this.scaleVec);

        this.gl.uniformMatrix4fv(matWorldUniform, false, this.matWorld);
        this.gl.bindVertexArray(this.vao);
        this.gl.drawElements(this.gl.TRIANGLES, this.numInds, this.gl.UNSIGNED_SHORT, 0);
        this.gl.bindVertexArray(null);
    }
}

Math.TAO = Math.PI * 2;

export function introTo3DDemo(mazeData) {
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
    const mazeShape = new MazeShape(gl, mazeData, posAttrib);

    if (!cubeVao || !tableVao) {
        showError(`Failed to create VAOs: cube=${!!cubeVao} table=${!!tableVao}`);
        return;
    }

    const UP_VEC = vec3.fromValues(0, 1, 0);
    const shapes = [
        new Shape(vec3.fromValues(0, 0, 0), 1, UP_VEC, 0, tableVao, TABLE_INDICES.length), // Ground
        new Shape(vec3.fromValues(0, 0.4, 0), 0.4, UP_VEC, 0, cubeVao, CUBE_INDICES.length), // Center
        new Shape(vec3.fromValues(1, 0.05, 1), 0.05, UP_VEC, 0, cubeVao, CUBE_INDICES.length),
        new Shape(vec3.fromValues(1, 0.1, -1), 0.1, UP_VEC, 0, cubeVao, CUBE_INDICES.length),
        new Shape(vec3.fromValues(-1, 0.15, 1), 0.15, UP_VEC, 0, cubeVao, CUBE_INDICES.length),
        new Shape(vec3.fromValues(-1, 0.2, -1), 0.2, UP_VEC, 0, cubeVao, CUBE_INDICES.length),
    ];

    const matView = mat4.create();
    const matProj = mat4.create();
    const matViewProj = mat4.create();
    const lookAtPos = vec3.create(0, 0, 0);

    //
    // Render!
    let lastFrameTime = performance.now();

    // const cameraPOS = vec3.fromValues((mazeData.size.COLS / 2) * MazeShape.cellSize, 20, (-mazeData.size.ROWS / 2) * MazeShape.cellSize);
    const cameraPOS = vec3.fromValues(0, 20, 0);
    const cameraRot = [0, -Math.PI / 2];

    const maxR = Math.PI / 2; // * 0.95;

    const sensitivity = 6;
    let cameraSpeed = 6;

    canvas.addEventListener("click", (e) => {
        canvas.requestPointerLock({
            // unadjustedMovement: true,
        });
        canvas.onmousemove = (e) => {
            if (document.pointerLockElement != canvas) return;
            cameraRot[0] += glMatrix.toRadian(e.movementX) / sensitivity;
            cameraRot[1] -= glMatrix.toRadian(e.movementY) / sensitivity;

            cameraRot[0] %= Math.TAO;
            while (cameraRot[0] < 0) cameraRot[0] += Math.TAO;
            if (cameraRot[1] < -maxR) cameraRot[1] = -maxR;
            else if (cameraRot[1] > maxR) cameraRot[1] = maxR;
        };
        canvas.onmousewheel = (e) => {
            cameraSpeed = Math.max(0, cameraSpeed - e.deltaY / 500);
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
        timer = 10;

    const frame = function () {
        const thisFrameTime = performance.now();
        const dt = (thisFrameTime - lastFrameTime) / 1000;
        lastFrameTime = thisFrameTime;
        const dtSpeed = cameraSpeed * dt;

        average += 1 / dt;

        if (++frameCheck % timer == 0) {
            fps.innerHTML = Math.floor(average / timer);
            frameCheck = timer;
            average = 0;
        }

        if (pressed.Space) cameraPOS[1] += dtSpeed;
        if (pressed.ShiftLeft) cameraPOS[1] -= dtSpeed;
        if (pressed.KeyW && !pressed.KeyS) {
            cameraPOS[0] += Math.cos(cameraRot[0]) * dtSpeed;
            cameraPOS[2] += Math.sin(cameraRot[0]) * dtSpeed;
        }
        if (pressed.KeyA && !pressed.KeyD) {
            cameraPOS[0] += Math.cos(cameraRot[0] - Math.PI / 2) * dtSpeed;
            cameraPOS[2] += Math.sin(cameraRot[0] - Math.PI / 2) * dtSpeed;
        }
        if (pressed.KeyS && !pressed.KeyW) {
            cameraPOS[0] -= Math.cos(cameraRot[0]) * dtSpeed;
            cameraPOS[2] -= Math.sin(cameraRot[0]) * dtSpeed;
        }
        if (pressed.KeyD && !pressed.KeyA) {
            cameraPOS[0] += Math.cos(cameraRot[0] + Math.PI / 2) * dtSpeed;
            cameraPOS[2] += Math.sin(cameraRot[0] + Math.PI / 2) * dtSpeed;
        }

        //
        // Update

        const cosY = Math.cos(cameraRot[1]);

        vec3.add(lookAtPos, cameraPOS, vec3.fromValues(Math.cos(cameraRot[0]) * cosY, Math.sin(cameraRot[1]), Math.sin(cameraRot[0]) * cosY));

        lookat(matView, /* pos= */ cameraPOS, /* lookAt= */ lookAtPos, /* up= */ vec3.fromValues(0, 1, 0), cameraRot[0]);
        mat4.perspective(matProj, /* fovy= */ glMatrix.toRadian(90), /* aspectRatio= */ canvas.width / canvas.height, /* near, far= */ 0.1, 100.0);

        // in GLM:    matViewProj = matProj * matView
        mat4.multiply(matViewProj, matProj, matView);

        //
        // Render
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;

        gl.clearColor(0.02, 0.02, 0.02, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.viewport(0, 0, canvas.width, canvas.height);

        gl.useProgram(demoProgram);
        gl.uniformMatrix4fv(matViewProjUniform, false, matViewProj);
        gl.uniform1i(mazeCheckUniform, 0);

        shapes.forEach((shape) => shape.draw(gl, matWorldUniform));
        gl.uniform1i(mazeCheckUniform, 1);
        mazeShape.draw(matWorldUniform);
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}
