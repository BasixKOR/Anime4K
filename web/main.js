import { quadVert, scaleFrag, umFrag, pushFrag, gradFrag, finalFrag, drawFrag } from './shaderSource.mjs'

function createShader(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);

    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
    }

    return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
    var program = gl.createProgram();

    var vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    var fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);

    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program));
    }

    var wrapper = {program: program};

    var numAttributes = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (var i = 0; i < numAttributes; i++) {
        var attribute = gl.getActiveAttrib(program, i);
        wrapper[attribute.name] = gl.getAttribLocation(program, attribute.name);
    }
    var numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i$1 = 0; i$1 < numUniforms; i$1++) {
        var uniform = gl.getActiveUniform(program, i$1);
        wrapper[uniform.name] = gl.getUniformLocation(program, uniform.name);
    }

    return wrapper;
}

function createTexture(gl, filter, data, width, height) {
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    if (data instanceof Uint8Array) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
}

function bindTexture(gl, texture, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
}

function createBuffer(gl, data) {
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
}

function bindAttribute(gl, buffer, attribute, numComponents) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, numComponents, gl.FLOAT, false, 0, 0);
}

function bindFramebuffer(gl, framebuffer, texture) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    if (texture) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    }
}

function Scaler(gl) {
    this.gl = gl;

    this.inputTex = null;
    this.inputWidth = 0;
    this.inputHeight = 0;

    this.quadBuffer = createBuffer(gl, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));
    this.framebuffer = gl.createFramebuffer();
    
    this.scaleProgram = createProgram(gl, quadVert, scaleFrag);
    this.lumProgram = createProgram(gl, quadVert, lumFrag);
    this.pushProgram = createProgram(gl, quadVert, pushFrag);
    this.gradProgram = createProgram(gl, quadVert, gradFrag);
    this.finalProgram = createProgram(gl, quadVert, finalFrag);
    this.drawProgram = createProgram(gl, quadVert, drawFrag);
    
    this.tempTexture = null;
    this.tempTexture2 = null;
    this.tempTexture3 = null;

    this.bold = 6.0;
    this.blur = 2.0;
}

Scaler.prototype.input = function(img) {
    const gl = this.gl;

    this.inputWidth = img.width;
    this.inputHeight = img.height;

    this.inputTex = createTexture(gl, gl.LINEAR, img);
}

Scaler.prototype.resize = function(scale) {
    const gl = this.gl;

    const width = Math.round(this.inputWidth * scale);
    const height = Math.round(this.inputHeight * scale);

    gl.canvas.width = width;
    gl.canvas.height = height;

    let emptyPixels = new Uint8Array(width * height * 4);
    this.scaleTexture = createTexture(gl, gl.LINEAR, emptyPixels, width, height);
    this.tempTexture = createTexture(gl, gl.LINEAR, emptyPixels, width, height);
    this.tempTexture2 = createTexture(gl, gl.LINEAR, emptyPixels, width, height);
    this.tempTexture3 = createTexture(gl, gl.LINEAR, emptyPixels, width, height);
}

Scaler.prototype.render = function() {
    if (!this.inputTex) {
        return;
    }


    const gl = this.gl;
    const scalePgm = this.scaleProgram;
    const lumPgm = this.lumProgram;
    const pushPgm = this.pushProgram;
    const gradPgm = this.gradProgram;
    const finalPgm = this.finalProgram;
    const drawPgm = this.drawProgram;


    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);


    // First upscaling with Bicubic interpolation.

    bindFramebuffer(gl, this.framebuffer, this.scaleTexture);

    gl.useProgram(scalePgm.program);

    bindAttribute(gl, this.quadBuffer, scalePgm.a_pos, 2);
    bindTexture(gl, this.inputTex, 0);
    gl.uniform1i(scalePgm.u_texture, 0);
    gl.uniform2f(scalePgm.u_size, this.inputWidth, this.inputHeight);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Scaled: scaleTexture


    bindFramebuffer(gl, this.framebuffer, this.tempTexture);

    gl.useProgram(lumPgm.program);

    bindAttribute(gl, this.quadBuffer, lumPgm.a_pos, 2);
    bindTexture(gl, this.scaleTexture, 0);
    gl.uniform1i(lumPgm.u_texture, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Scaled: scaleTexture
    // PostKernel: tempTexture


    bindFramebuffer(gl, this.framebuffer, this.tempTexture2);

    gl.useProgram(pushPgm.program);

    bindAttribute(gl, this.quadBuffer, pushPgm.a_pos, 2);
    bindTexture(gl, this.scaleTexture, 0);
    bindTexture(gl, this.tempTexture, 1);
    gl.uniform1i(pushPgm.u_texture, 0);
    gl.uniform1i(pushPgm.u_textureTemp, 1);
    gl.uniform1f(pushPgm.u_scale, gl.canvas.width / this.inputWidth);
    gl.uniform2f(pushPgm.u_pt, 1.0 / gl.canvas.width, 1.0 / gl.canvas.height);
    gl.uniform1f(pushPgm.u_bold, this.bold);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Scaled: tempTexture2
    // PostKernel: tempTexture


    bindFramebuffer(gl, this.framebuffer, this.tempTexture);

    gl.useProgram(lumPgm.program);

    bindAttribute(gl, this.quadBuffer, lumPgm.a_pos, 2);
    bindTexture(gl, this.tempTexture2, 0);
    gl.uniform1i(lumPgm.u_texture, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Scaled: tempTexture2
    // PostKernel: tempTexture


    bindFramebuffer(gl, this.framebuffer, this.tempTexture3);

    gl.useProgram(gradPgm.program);

    bindAttribute(gl, this.quadBuffer, gradPgm.a_pos, 2);
    bindTexture(gl, this.tempTexture2, 0);
    bindTexture(gl, this.tempTexture, 1);
    gl.uniform1i(gradPgm.u_texture, 0);
    gl.uniform1i(gradPgm.u_textureTemp, 1);
    gl.uniform2f(gradPgm.u_pt, 1.0 / gl.canvas.width, 1.0 / gl.canvas.height);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Scaled: tempTexture2
    // PostKernel: tempTexture3


    bindFramebuffer(gl, this.framebuffer, this.tempTexture);

    gl.useProgram(finalPgm.program);

    bindAttribute(gl, this.quadBuffer, finalPgm.a_pos, 2);
    bindTexture(gl, this.tempTexture2, 0);
    bindTexture(gl, this.tempTexture3, 1);
    gl.uniform1i(finalPgm.u_texture, 0);
    gl.uniform1i(finalPgm.u_textureTemp, 1);
    gl.uniform1f(finalPgm.u_scale, gl.canvas.width / this.inputWidth);
    gl.uniform2f(finalPgm.u_pt, 1.0 / gl.canvas.width, 1.0 / gl.canvas.height);
    gl.uniform1f(finalPgm.u_blur, this.blur);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Scaled: tempTexture
    // PostKernel: tempTexture3


    bindFramebuffer(gl, null);

    gl.useProgram(drawPgm.program);

    bindAttribute(gl, this.quadBuffer, drawPgm.a_pos, 2);
    bindTexture(gl, this.tempTexture, 0);
    bindTexture(gl, this.inputTex, 1);
    gl.uniform1i(drawPgm.u_texture, 0);
    gl.uniform1i(drawPgm.u_textureOrig, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
}


var scaler = null;

function onLoad() {
    const txtScale = document.getElementById('txtScale');
    const barBold = document.getElementById('sliderBold');
    const barBlur = document.getElementById('sliderBlur');

    const board = document.getElementById('board');
    const gl = board.getContext('webgl');


    const inputImg = new Image();
    inputImg.src = "input.png";
    inputImg.onload = function() {
        let scale = parseFloat(txtScale.value);

        scaler = new Scaler(gl);
        scaler.input(inputImg);
        scaler.resize(scale);
    }


    function render() {
        if (scaler) {
            scaler.bold = parseFloat(barBold.value);
            scaler.blur = parseFloat(barBlur.value);
    
            scaler.render();
        }

        requestAnimationFrame(render);
    }
    
    requestAnimationFrame(render);
}

function changeImage(src) {
    const txtScale = document.getElementById('txtScale');

    const inputImg = new Image();
    inputImg.crossOrigin = "Anonymous";
    inputImg.src = src;
    inputImg.onload = function() {
        let scale = parseFloat(txtScale.value);

        scaler.input(inputImg);
        scaler.resize(scale);
    }
    inputImg.onerror = function() {
        alert("Can't load the image.");
    }
}

function onImageChanged() {
    const txtSrc = document.getElementById('txtSrc');
    changeImage(txtSrc.value);
}

function onSelectFile(input) {
    if (input.files && input.files[0]) {
        var reader = new FileReader();
        reader.onload = function (e) {
            changeImage(e.target.result);
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function onScaleChanged() {
    const txtScale = document.getElementById('txtScale');

    scaler.resize(parseFloat(txtScale.value));
}