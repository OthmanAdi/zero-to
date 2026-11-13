import { ClampToEdgeWrapping, MeshPhysicalMaterial, MeshStandardMaterial, SRGBColorSpace, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { defaultCompassColors } from './compass';
import {
  configureDialTexture,
  createBrass,
  createGlass,
  createNeedleShadow,
  dialTextureSize,
  type MaterialSetup,
} from './materials';

const setup = (phone: boolean): MaterialSetup => ({ colors: defaultCompassColors(), envMap: null, phone });

describe('configureDialTexture', () => {
  it('puts the painted dial on unmirrored: flipped once, never repeated, turned or offset', () => {
    const texture = new Texture();
    // Start from settings that would mirror and turn it, to prove they are all reset.
    texture.flipY = false;
    texture.repeat.set(-1, 1);
    texture.offset.set(1, 0);
    texture.rotation = Math.PI;
    configureDialTexture(texture);
    expect(texture.flipY).toBe(true);
    expect(texture.repeat.toArray()).toEqual([1, 1]);
    expect(texture.offset.toArray()).toEqual([0, 0]);
    expect(texture.rotation).toBe(0);
    expect(texture.wrapS).toBe(ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(ClampToEdgeWrapping);
    expect(texture.colorSpace).toBe(SRGBColorSpace);
  });
});

describe('dialTextureSize', () => {
  it('caps the canvas at 2048 on desktops and 1024 on phones, in powers of two', () => {
    expect(dialTextureSize(4096, false)).toBe(2048);
    expect(dialTextureSize(2048, false)).toBe(2048);
    expect(dialTextureSize(2048, true)).toBe(1024);
    expect(dialTextureSize(1000, true)).toBe(512);
    expect(dialTextureSize(0, false)).toBe(256);
  });
});

describe('materials', () => {
  it('makes brass a metal inside the asked roughness range, lighter on phones', () => {
    const desktop = createBrass(setup(false));
    const phone = createBrass(setup(true));
    for (const material of [desktop, phone]) {
      expect(material.metalness).toBe(1);
      expect(material.roughness).toBeGreaterThanOrEqual(0.18);
      expect(material.roughness).toBeLessThanOrEqual(0.35);
      expect(material.vertexColors).toBe(true);
    }
    expect(desktop).toBeInstanceOf(MeshPhysicalMaterial);
    expect((desktop as MeshPhysicalMaterial).anisotropy).toBeGreaterThan(0);
    expect(phone).toBeInstanceOf(MeshStandardMaterial);
    expect(phone).not.toBeInstanceOf(MeshPhysicalMaterial);
  });

  it('keeps the glass from burning out: a capped, rough-edged glint laid over the dial', () => {
    const { material, uniforms } = createGlass(setup(false));
    expect(material.transparent).toBe(true);
    expect(material.premultipliedAlpha).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.transmission).toBe(0);
    expect(material.clearcoatRoughness).toBeGreaterThan(0.05);
    expect(material.envMapIntensity).toBeLessThan(0.2);
    // A finite cap: the glint can approach it but cannot grow past it, whatever the lamp.
    expect(uniforms.glassCap.value).toBeGreaterThan(0.1);
    expect(uniforms.glassCap.value).toBeLessThan(3);
    expect(uniforms.glassRimStrength.value).toBeLessThan(0.15);

    // The patch must find its three anchors in the shader it is given.
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader: [
        'void main() {',
        '#include <opaque_fragment>',
        '#include <tonemapping_fragment>',
        '#include <premultiplied_alpha_fragment>',
        '}',
      ].join('\n'),
    };
    material.onBeforeCompile(shader as never, null as never);
    expect(shader.uniforms.glassCap).toBe(uniforms.glassCap);
    expect(shader.fragmentShader).toContain('uniform float glassCap;');
    expect(shader.fragmentShader).toContain('1.0 + glassPeak / glassCap');
    expect(shader.fragmentShader).not.toContain('#include <premultiplied_alpha_fragment>');
    expect(shader.fragmentShader).toContain('gl_FragColor.a = max( gl_FragColor.a');
  });

  it('draws the needle shadow dark, see-through and with the softness from the vertices', () => {
    const material = createNeedleShadow();
    expect(material.transparent).toBe(true);
    expect(material.vertexColors).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.opacity).toBeGreaterThan(0.15);
    expect(material.opacity).toBeLessThan(0.5);
  });
});
