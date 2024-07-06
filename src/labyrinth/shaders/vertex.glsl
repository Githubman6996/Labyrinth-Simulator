#version 300 es
precision mediump float;

in vec3 vertexPosition;
in vec3 vertexColor;

out vec3 fragmentColor;

uniform mat4 matWorld;
uniform mat4 matViewProj;
uniform bool mazeCheck;

void main() {
  if (mazeCheck) fragmentColor = vec3(1, 1 ,1);
  else fragmentColor = vertexColor;

  gl_Position = matViewProj * matWorld * vec4(vertexPosition, 1.0);
}