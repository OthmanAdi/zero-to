/**
 * What three.js's physical material cannot do from its own maps, added to its shader in three places.
 *
 * A stamp is one mask per face. Reading it once in the fragment shader gives everything a stamp changes:
 * colour, roughness, metalness, sheen, clearcoat, thin film and the pressed edge. The alternative, a
 * derived roughness, normal and film texture for each face of each volume, costs several megabytes per
 * book and a pass over every pixel on the CPU. The binding's own relief stays in the ordinary normal
 * map, tiled; the pressed edge, the turn of the covering over the board edge, the joint and the round
 * of the spine are leaned onto that normal afterwards.
 *
 * The additions hang on three anchors in the stock shader. If a later three.js renames one, the patch
 * is skipped as a whole and the material falls back to the stock look.
 */
import type * as THREE from 'three';

export interface BindingUniforms {
  /** x: how strongly the tile's shade is printed in, y: exponent on the print's brightness, z: film shift in nm, w: how far the print is paled toward silver. */
  bbDetail: { value: THREE.Vector4 };
}

export interface FaceUniforms extends BindingUniforms {
  bbStamp: { value: THREE.Texture | null };
  /** Step between the mask samples that find the pressed edge, in UV. */
  bbStampTexel: { value: THREE.Vector2 };
  bbStampColor: { value: THREE.Color };
  /** x tint, y shade, z flatten, w deboss. */
  bbStampMix: { value: THREE.Vector4 };
  /** Roughness a + b * binding (x, y), metalness a + b * binding (z, w). */
  bbStampPbr: { value: THREE.Vector4 };
  /** x sheen kept, y clearcoat kept, z film outside the mask, w film inside it. */
  bbStampFx: { value: THREE.Vector4 };
  /** Face size in CSS px. */
  bbFaceSize: { value: THREE.Vector2 };
  /** x unused, y how the rubbed edge shows (positive burnished darker, negative rubbed pale), z bevel width px, w bevel lean. */
  bbEdge: { value: THREE.Vector4 };
  /** x joint centre px from the left edge, y joint half width px, z joint depth, w round of the spine. */
  bbJoint: { value: THREE.Vector4 };
  /** x how much more of the room the stamp mirrors (0 none), y darkening at the foot of the pressed wall, z 1 on a metal board, where the print is laid down dark. */
  bbFoil: { value: THREE.Vector4 };
  /** The plain colour of the covering, to tell the print from it. */
  bbCloth: { value: THREE.Color };
  /** x sun on this face, y how rubbed the corners are, z how dull the foil is at the head, w how much the sun has lightened the face. */
  bbUse: { value: THREE.Vector4 };
  /** Reach of the rubbed edge in px: x from the left and right edges, y from head and tail. */
  bbRub: { value: THREE.Vector4 };
}

const ANCHOR_MAIN = 'void main() {';
const ANCHOR_SURFACE = '#include <normal_fragment_maps>';
const ANCHOR_LAYERS = '#include <lights_physical_fragment>';
/** Optional: where the mirrored room has been read and not yet used. Without it foil keeps the plain room. */
const ANCHOR_ROOM = '#include <lights_fragment_maps>';

const PARS = /* glsl */ `
uniform vec4 bbDetail;
#ifdef BB_FACE
	uniform sampler2D bbStamp;
	uniform vec2 bbStampTexel;
	uniform vec3 bbStampColor;
	uniform vec4 bbStampMix;
	uniform vec4 bbStampPbr;
	uniform vec4 bbStampFx;
	uniform vec2 bbFaceSize;
	uniform vec4 bbEdge;
	uniform vec4 bbJoint;
	uniform vec4 bbFoil;
	uniform vec3 bbCloth;
	uniform vec4 bbUse;
	uniform vec4 bbRub;
#endif
float bbMask = 0.0;
float bbPrinted = 0.0;
`;

const SURFACE = /* glsl */ `
#ifdef BB_FACE
	// What is printed on the board, as against its plain covering. Only a metal board asks.
	bbPrinted = bbFoil.z * smoothstep( 0.04, 0.2, distance( diffuseColor.rgb, bbCloth ) );
#endif
#ifdef USE_ROUGHNESSMAP
	// The tile's red channel: hollows and single threads printed into the colour.
	diffuseColor.rgb *= 1.0 + ( texelRoughness.r * 2.0 - 1.0 ) * bbDetail.x;
#endif
{
	// Lift a dark print so it can work as a metal, keeping its hue.
	float bbLuma = max( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0001 );
	diffuseColor.rgb = min( diffuseColor.rgb * ( pow( bbLuma, bbDetail.y ) / bbLuma ), vec3( 1.0 ) );
	// A holographic foil is a pale silver that the film colours, whatever is printed on it.
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.93, 0.94, 0.96 ), bbDetail.w );
	#ifdef USE_ROUGHNESSMAP
		// Its brighter flakes stay brighter under the silver.
		diffuseColor.rgb = min( diffuseColor.rgb * ( 1.0 + max( texelRoughness.r * 2.0 - 1.0, 0.0 ) * bbDetail.w ), vec3( 1.0 ) );
	#endif
}
#ifdef BB_FACE
	// On a metal board the print is laid down in a dark matt ink, so a title can be read against the shine.
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.03, 0.028, 0.026 ), bbPrinted );
	roughnessFactor = mix( roughnessFactor, 0.62, bbPrinted );
	metalnessFactor *= 1.0 - bbPrinted;
#endif
#if defined( BB_FACE ) && defined( USE_MAP ) && defined( USE_NORMALMAP_TANGENTSPACE )
{
	vec2 bbUv = vMapUv;
	bbMask = texture2D( bbStamp, bbUv ).r;
	vec2 bbSlope = vec2(
		texture2D( bbStamp, bbUv + vec2( bbStampTexel.x, 0.0 ) ).r - texture2D( bbStamp, bbUv - vec2( bbStampTexel.x, 0.0 ) ).r,
		texture2D( bbStamp, bbUv + vec2( 0.0, bbStampTexel.y ) ).r - texture2D( bbStamp, bbUv - vec2( 0.0, bbStampTexel.y ) ).r
	);
	vec2 bbPx = bbUv * bbFaceSize;
	vec2 bbFromEdge = min( bbPx, bbFaceSize - bbPx );

	// Sun: a spine that has stood in the light for years has lost colour and yellowed a little.
	float bbDepth = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( bbDepth ), 0.3 * bbUse.x ) * mix( vec3( 1.0 ), vec3( 1.04, 1.0, 0.88 ), bbUse.x ) * ( 1.0 + bbUse.w );

	// Hands: edges rub, corners take the knocks, and the high points of the grain go first.
	vec2 bbReach = max( bbRub.xy, vec2( 0.001 ) );
	vec2 bbRubbed = 1.0 - smoothstep( vec2( 0.0 ), bbReach, bbFromEdge );
	vec2 bbKnock = 1.0 - smoothstep( vec2( 0.0 ), bbReach * 2.4, bbFromEdge );
	float bbWear = min( 1.0, max( bbRubbed.x, bbRubbed.y ) + 2.2 * bbUse.y * bbKnock.x * bbKnock.y );
	#ifdef USE_ROUGHNESSMAP
		bbWear *= mix( 1.0, smoothstep( 0.4, 0.52, texelRoughness.r ), 0.5 * bbUse.y );
	#endif
	if ( bbEdge.y >= 0.0 ) {
		// Burnished: darker and smoother, as leather goes.
		diffuseColor.rgb *= 1.0 - bbEdge.y * bbWear;
		roughnessFactor *= 1.0 - 0.6 * bbEdge.y * bbWear;
	} else {
		// Rubbed pale, toward the thread or the card.
		diffuseColor.rgb += - bbEdge.y * bbWear * ( 0.25 + bbDepth ) * vec3( 1.0, 0.96, 0.88 );
	}

	// Foil thins and dulls at the head of a spine, where a finger hooks the volume out.
	float bbHook = bbUse.z * smoothstep( 0.8, 0.96, bbUv.y );
	float bbLaid = bbMask * ( 1.0 - 0.3 * bbHook );
	diffuseColor.rgb = mix( diffuseColor.rgb, bbStampColor, bbLaid * bbStampMix.x );
	diffuseColor.rgb *= mix( 1.0, bbStampMix.y, bbMask );
	roughnessFactor = mix( roughnessFactor, min( 1.0, bbStampPbr.x + bbStampPbr.y * roughnessFactor + 0.25 * bbHook ), bbMask );
	metalnessFactor = mix( metalnessFactor, bbStampPbr.z + bbStampPbr.w * metalnessFactor, bbLaid );

	// Pressed flat inside the stamp: a bed, with a hairline wall at its edge that leans toward the inside
	// and is dark at its foot.
	normal = normalize( mix( normal, nonPerturbedNormal, bbMask * bbStampMix.z ) );
	vec2 bbLean = bbSlope * bbStampMix.w;
	diffuseColor.rgb *= 1.0 - bbFoil.y * min( 1.0, abs( bbSlope.x ) + abs( bbSlope.y ) );

	// The covering turns over the edge of the board.
	bbLean += ( 1.0 - smoothstep( vec2( 0.0 ), vec2( max( bbEdge.z, 0.001 ) ), bbFromEdge ) ) * sign( bbUv - 0.5 ) * bbEdge.w;
	// A spine is rounded across its width.
	bbLean.x += ( bbUv.x * 2.0 - 1.0 ) * bbJoint.w;
	// The joint: a groove along the spine side of a board.
	float bbAcross = ( bbPx.x - bbJoint.x ) / max( bbJoint.y, 0.001 );
	float bbGroove = exp( - bbAcross * bbAcross ) * bbJoint.z;
	bbLean.x -= 2.0 * bbAcross * bbGroove;
	diffuseColor.rgb *= 1.0 - 0.28 * min( bbGroove, 1.0 );

	normal = normalize( normal + normalize( tbn[ 0 ] ) * bbLean.x + normalize( tbn[ 1 ] ) * bbLean.y );

	// Relief finer than a pixel cannot throw single glints: where the normal changes quickly from one
	// pixel to the next the highlight is spread instead, so a resting spine does not sparkle or crawl.
	vec3 bbTurn = max( abs( dFdx( normal ) ), abs( dFdy( normal ) ) );
	roughnessFactor = min( 1.0, roughnessFactor + min( 0.18, 0.5 * max( bbTurn.x, max( bbTurn.y, bbTurn.z ) ) ) );
}
#endif
`;

const ROOM = /* glsl */ `
#if defined( BB_FACE ) && defined( RE_IndirectSpecular )
	radiance *= 1.0 + bbFoil.x * bbMask;
#endif
`;

const LAYERS = /* glsl */ `
#ifdef BB_FACE
	#ifdef USE_SHEEN
		material.sheenColor *= mix( 1.0, bbStampFx.x, bbMask );
	#endif
	#ifdef USE_CLEARCOAT
		material.clearcoat *= mix( 1.0, bbStampFx.y, bbMask );
	#endif
	#ifdef USE_IRIDESCENCE
		material.iridescence *= mix( bbStampFx.z, bbStampFx.w, bbMask ) * ( 1.0 - bbPrinted );
	#endif
#endif
#ifdef USE_IRIDESCENCE
{
	// A thin film changes colour with the angle of view only. A holographic foil runs through its
	// colours as the light moves, so the film is made thicker or thinner by where the surface looks
	// in the room, which also follows the room when it is turned.
	vec3 bbBounce = inverseTransformDirection( reflect( - normalize( vViewPosition ), nonPerturbedNormal ), viewMatrix );
	#ifdef USE_ENVMAP
		bbBounce = envMapRotation * bbBounce;
	#endif
	material.iridescenceThickness = max( material.iridescenceThickness + bbDetail.z * ( bbBounce.x + 0.6 * bbBounce.y ), 90.0 );
}
#endif
`;

/** The stock fragment shader with the binding code added, or unchanged when an anchor is missing. */
export function patchFragmentShader(source: string): string {
  if (!source.includes(ANCHOR_MAIN) || !source.includes(ANCHOR_SURFACE) || !source.includes(ANCHOR_LAYERS)) return source;
  return source
    .replace(ANCHOR_MAIN, `${PARS}\n${ANCHOR_MAIN}`)
    .replace(ANCHOR_SURFACE, `${ANCHOR_SURFACE}\n${SURFACE}`)
    .replace(ANCHOR_LAYERS, `${ANCHOR_LAYERS}\n${LAYERS}`)
    .replace(ANCHOR_ROOM, `${ANCHOR_ROOM}\n${ROOM}`);
}

/** Every patched material compiles to the same program as the others with the same features. */
export const PROGRAM_KEY = 'bb-binding-4';

/**
 * Adds the binding code to a physical material. `face` materials carry a stamp mask and read the
 * face uniforms; the others only use the tile's shade and the lift of the colour.
 */
export function applyBindingShader(material: THREE.MeshPhysicalMaterial, uniforms: BindingUniforms | FaceUniforms, face: boolean): void {
  if (face) material.defines = { ...material.defines, BB_FACE: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = patchFragmentShader(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => PROGRAM_KEY;
}
