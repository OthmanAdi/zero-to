#!/usr/bin/env node
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
// \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __esmMin = (fn, res, err) => () => {
	if (err) throw err[0];
	try {
		return fn && (res = fn(fn = 0)), res;
	} catch (e) {
		throw err = [e], e;
	}
};
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
// src/cli/io.ts
/**
* Everything the command-line tool needs from the outside world, in one object, so tests can hand in their own
* output sinks, clock and network. Files are read and written with `node:fs` directly; tests use temp folders.
*/
function nodeIo(scriptDir) {
	return {
		out: (text) => process.stdout.write(`${text}\n`),
		err: (text) => process.stderr.write(`${text}\n`),
		cwd: process.cwd(),
		scriptDir,
		fetch: (url, init) => fetch(url, init),
		now: () => /* @__PURE__ */ new Date()
	};
}
/** A problem the tool reports in plain words, with the exit code it should end with. */
var CliError = class extends Error {
	exitCode;
	constructor(message, exitCode) {
		super(message);
		this.name = "CliError";
		this.exitCode = exitCode;
	}
};
function resolvePath(io, path) {
	return resolve(io.cwd, path);
}
/** Reads and parses a JSON file. A missing file is a usage problem (2), broken JSON a file problem (1). */
function readJsonFile(path, what = "file") {
	if (!existsSync(path)) throw new CliError(`Cannot find the ${what} ${path}.`, 2);
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch (cause) {
		throw new CliError(`Cannot read the ${what} ${path}: ${cause instanceof Error ? cause.message : String(cause)}`, 2);
	}
	if (text.charCodeAt(0) === 65279) text = text.slice(1);
	try {
		return JSON.parse(text);
	} catch (cause) {
		throw new CliError(`The ${what} ${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`, 1);
	}
}
/** JSON as the roadmap files are written: two-space indent and a final newline. */
function toJsonText(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}
/** The local calendar day of a date, as YYYY-MM-DD. */
function localDay(date) {
	const pad = (n) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
// src/roadmap/dates.ts
/**
* Calendar days as "YYYY-MM-DD" strings, computed in UTC so that a day is always 24 hours and nothing depends on
* the machine's time zone.
*/
var DAY_MS = 864e5;
/** Milliseconds since 1970 for a real calendar day, or null for anything else (also "2026-02-30"). */
function parseDay(text) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const ms = Date.UTC(year, month - 1, day);
	const back = new Date(ms);
	if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
	return ms;
}
/** A day given as text or as a Date (its UTC day). Throws on text that is not a real day. */
function toDayMs(day) {
	if (typeof day !== "string") return Math.floor(day.getTime() / DAY_MS) * DAY_MS;
	const ms = parseDay(day.slice(0, 10));
	if (ms === null) throw new Error(`"${day}" is not a calendar day (expected YYYY-MM-DD)`);
	return ms;
}
/** Whole days from `from` to `to`; negative when `to` is earlier. */
function daysBetween(from, to) {
	return Math.round((toDayMs(to) - toDayMs(from)) / DAY_MS);
}
// src/roadmap/graph.ts
/** Every waypoint in route order. */
function allWaypoints(roadmap) {
	const nodes = [];
	roadmap.stages.forEach((stage, stageIndex) => {
		stage.waypoints.forEach((waypoint, waypointIndex) => {
			nodes.push({
				stage,
				stageIndex,
				waypoint,
				waypointIndex
			});
		});
	});
	return nodes;
}
/** Stage ids a stage waits for. Default: the stage before; the first stage waits for nothing. */
function stageRequires(roadmap, stageIndex) {
	const stage = roadmap.stages[stageIndex];
	if (!stage) return [];
	if (stage.requires) return stage.requires;
	const before = roadmap.stages[stageIndex - 1];
	return before ? [before.id] : [];
}
/** Waypoint ids a waypoint waits for. Default: the waypoint before it in the same stage. */
function waypointRequires(stage, waypointIndex) {
	const waypoint = stage.waypoints[waypointIndex];
	if (!waypoint) return [];
	if (waypoint.requires) return waypoint.requires;
	const before = stage.waypoints[waypointIndex - 1];
	return before ? [before.id] : [];
}
// src/roadmap/schema-check.ts
/**
* A small checker for the subset of JSON Schema that `roadmap.schema.json` uses. It reads the schema file itself,
* so the schema and the validator cannot drift apart, and it words every problem for a learner or an author, not
* for a JSON Schema expert. No dependency.
*/
var ROADMAP_SCHEMA = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "urn:zero-to:roadmap:1",
	title: "zero-to roadmap",
	type: "object",
	additionalProperties: false,
	required: [
		"schema",
		"id",
		"title",
		"topic",
		"lang",
		"checkedOn",
		"brief",
		"stages",
		"resources"
	],
	properties: {
		"schema": { "const": "zero-to/1" },
		"id": { "$ref": "#/$defs/id" },
		"title": {
			"type": "string",
			"maxLength": 80
		},
		"topic": {
			"type": "string",
			"description": "The prompt as typed."
		},
		"summary": {
			"type": "string",
			"maxLength": 280
		},
		"lang": {
			"$ref": "#/$defs/lang",
			"description": "Language the roadmap itself is written in."
		},
		"checkedOn": {
			"$ref": "#/$defs/date",
			"description": "Day of the last full link check."
		},
		"freshness": {
			"enum": [
				"fast",
				"medium",
				"slow"
			],
			"default": "medium",
			"description": "How quickly the topic's sources go stale."
		},
		"reviewDays": {
			"type": "array",
			"items": {
				"type": "integer",
				"minimum": 1
			},
			"default": [
				2,
				7,
				21,
				60
			]
		},
		"brief": { "$ref": "#/$defs/brief" },
		"capstone": {
			"type": "object",
			"additionalProperties": false,
			"required": ["title", "brief"],
			"properties": {
				"title": { "type": "string" },
				"brief": { "type": "string" }
			}
		},
		"map": { "$ref": "#/$defs/map" },
		"stages": {
			"type": "array",
			"minItems": 2,
			"maxItems": 8,
			"items": { "$ref": "#/$defs/stage" }
		},
		"resources": {
			"type": "array",
			"items": { "$ref": "#/$defs/resource" }
		},
		"class": { "$ref": "#/$defs/class" }
	},
	$defs: {
		"id": {
			"type": "string",
			"pattern": "^[a-z0-9][a-z0-9-]{0,47}$"
		},
		"lang": {
			"type": "string",
			"pattern": "^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$"
		},
		"date": {
			"type": "string",
			"format": "date"
		},
		"tier": { "enum": [
			"bronze",
			"silver",
			"gold",
			"diamond"
		] },
		"ids": {
			"type": "array",
			"items": { "$ref": "#/$defs/id" },
			"uniqueItems": true
		},
		"map": {
			"type": "object",
			"additionalProperties": false,
			"description": "How the trek looks. Every field is optional; the site picks a landscape from the seed.",
			"properties": {
				"terrain": {
					"enum": [
						"volcano",
						"ridge",
						"massif",
						"twin-peaks",
						"plateau",
						"canyon",
						"random"
					],
					"default": "random",
					"description": "The shape of the mountain."
				},
				"trail": {
					"enum": [
						"switchback",
						"ridge-walk",
						"spiral",
						"valley-first",
						"traverse",
						"random"
					],
					"default": "random",
					"description": "How the route winds up it."
				},
				"seed": {
					"type": "string",
					"description": "Makes the landscape repeatable. Default: the roadmap id."
				},
				"surfaces": {
					"anyOf": [{ "const": "auto" }, {
						"type": "array",
						"minItems": 1,
						"items": { "enum": [
							"water",
							"sand",
							"grass",
							"forest",
							"dirt",
							"scree",
							"rock",
							"snow"
						] }
					}],
					"description": "Ground types from the bottom of the mountain to the top: a list made of water, sand, grass, forest, dirt, scree, rock and snow, or the word auto.",
					"default": "auto"
				},
				"signpost": {
					"type": "string",
					"description": "Asset key of the signpost model.",
					"default": "timber"
				},
				"theme": { "type": "string" }
			}
		},
		"brief": {
			"type": "object",
			"additionalProperties": false,
			"required": [
				"audience",
				"startLevel",
				"targetTier",
				"hoursPerWeek"
			],
			"properties": {
				"audience": { "enum": [
					"self",
					"student",
					"teacher"
				] },
				"goal": {
					"type": "string",
					"description": "One sentence, in the user's words."
				},
				"startLevel": { "enum": [
					"zero",
					"adjacent",
					"stuck",
					"gaps"
				] },
				"entry": {
					"$ref": "#/$defs/id",
					"description": "Stage where the red pin goes in. Default: first stage."
				},
				"targetTier": { "$ref": "#/$defs/tier" },
				"hoursPerWeek": {
					"type": "number",
					"exclusiveMinimum": 0
				},
				"startDate": { "$ref": "#/$defs/date" },
				"deadline": { "$ref": "#/$defs/date" },
				"style": {
					"enum": [
						"build",
						"course",
						"read",
						"watch"
					],
					"default": "build"
				},
				"budget": {
					"type": "object",
					"additionalProperties": false,
					"required": ["max", "currency"],
					"properties": {
						"max": {
							"type": ["number", "null"],
							"minimum": 0,
							"description": "0 is free only, null is no limit."
						},
						"currency": {
							"type": "string",
							"pattern": "^[A-Z]{3}$"
						}
					}
				},
				"resourceLangs": {
					"type": "array",
					"minItems": 1,
					"items": { "$ref": "#/$defs/lang" },
					"description": "In order of preference."
				},
				"projects": {
					"enum": [
						"capstone",
						"per-stage",
						"drills",
						"own"
					],
					"default": "capstone"
				},
				"gating": {
					"enum": [
						"open",
						"guided",
						"gated"
					],
					"default": "guided"
				},
				"theme": { "type": "string" }
			}
		},
		"stage": {
			"type": "object",
			"additionalProperties": false,
			"required": [
				"id",
				"title",
				"tier",
				"waypoints",
				"checkpoint"
			],
			"properties": {
				"id": { "$ref": "#/$defs/id" },
				"title": {
					"type": "string",
					"maxLength": 60
				},
				"tier": { "$ref": "#/$defs/tier" },
				"summary": {
					"type": "string",
					"maxLength": 200
				},
				"requires": {
					"$ref": "#/$defs/ids",
					"description": "Stage ids. Default: the stage before."
				},
				"waypoints": {
					"type": "array",
					"minItems": 1,
					"maxItems": 9,
					"items": { "$ref": "#/$defs/waypoint" }
				},
				"checkpoint": { "$ref": "#/$defs/checkpoint" },
				"project": { "$ref": "#/$defs/project" }
			}
		},
		"waypoint": {
			"type": "object",
			"additionalProperties": false,
			"required": [
				"id",
				"title",
				"note",
				"do",
				"minutes",
				"practiceMinutes",
				"resources"
			],
			"properties": {
				"id": { "$ref": "#/$defs/id" },
				"title": {
					"type": "string",
					"maxLength": 60
				},
				"note": {
					"type": "string",
					"maxLength": 240,
					"description": "Sticky note: what this step gives you."
				},
				"predict": {
					"type": "string",
					"description": "One question to answer before opening a resource."
				},
				"do": {
					"type": "string",
					"description": "The hands-on task and what to look at when it is done."
				},
				"minutes": {
					"type": "integer",
					"minimum": 5
				},
				"practiceMinutes": {
					"type": "integer",
					"minimum": 0
				},
				"requires": {
					"$ref": "#/$defs/ids",
					"description": "Waypoint ids. Default: the waypoint before."
				},
				"optional": {
					"type": "boolean",
					"default": false,
					"description": "A side trail."
				},
				"resources": {
					"$ref": "#/$defs/ids",
					"description": "Resource ids, the first is the main one."
				},
				"gap": {
					"type": "string",
					"description": "Written when no source could be verified for this step."
				},
				"takeaways": {
					"type": "array",
					"maxItems": 4,
					"items": {
						"type": "string",
						"maxLength": 140
					},
					"description": "Key points the learner can pin into a field notebook and take with them"
				},
				"checks": {
					"type": "array",
					"maxItems": 4,
					"items": { "$ref": "#/$defs/check" }
				},
				"teacherNote": {
					"type": "string",
					"description": "Removed from the student file."
				}
			}
		},
		"check": {
			"type": "object",
			"additionalProperties": false,
			"required": [
				"q",
				"kind",
				"answer"
			],
			"properties": {
				"q": { "type": "string" },
				"kind": { "enum": [
					"recall",
					"predict",
					"apply",
					"explain"
				] },
				"options": {
					"type": "array",
					"minItems": 2,
					"maxItems": 5,
					"items": { "type": "string" }
				},
				"correct": {
					"type": "integer",
					"minimum": 0,
					"description": "Index into options."
				},
				"answer": {
					"type": "string",
					"description": "Model answer, or why the correct option is correct."
				},
				"onMiss": {
					"$ref": "#/$defs/id",
					"description": "Waypoint to walk to after a miss."
				}
			},
			"dependentRequired": { "options": ["correct"] }
		},
		"checkpoint": {
			"type": "object",
			"additionalProperties": false,
			"required": ["title", "show"],
			"properties": {
				"title": {
					"type": "string",
					"maxLength": 60
				},
				"signpost": {
					"type": "string",
					"description": "Asset key. Default comes from the map."
				},
				"show": {
					"type": "array",
					"minItems": 1,
					"maxItems": 5,
					"items": { "type": "string" },
					"description": "Things the learner can show, test or explain. One signpost arm each."
				},
				"checks": {
					"type": "array",
					"maxItems": 6,
					"items": { "$ref": "#/$defs/check" }
				},
				"pass": {
					"type": "number",
					"exclusiveMinimum": 0,
					"maximum": 1,
					"default": .8
				}
			}
		},
		"project": {
			"type": "object",
			"additionalProperties": false,
			"required": [
				"title",
				"brief",
				"rungs"
			],
			"properties": {
				"title": {
					"type": "string",
					"maxLength": 60
				},
				"brief": { "type": "string" },
				"minutes": {
					"type": "integer",
					"minimum": 10
				},
				"capstone": {
					"type": "boolean",
					"default": false,
					"description": "Continues the roadmap's capstone."
				},
				"rungs": {
					"type": "array",
					"minItems": 1,
					"maxItems": 3,
					"items": {
						"type": "object",
						"additionalProperties": false,
						"required": ["level", "task"],
						"properties": {
							"level": { "enum": [
								"guided",
								"changed",
								"own"
							] },
							"task": { "type": "string" }
						}
					}
				},
				"resources": {
					"$ref": "#/$defs/ids",
					"description": "Shown on the shelf while the walker is at the camp."
				},
				"choices": {
					"type": "array",
					"items": { "type": "string" },
					"description": "The same menu for everyone."
				},
				"criteria": {
					"type": "array",
					"maxItems": 5,
					"items": { "type": "string" }
				}
			}
		},
		"resource": {
			"type": "object",
			"additionalProperties": false,
			"required": [
				"id",
				"title",
				"url",
				"type",
				"cost",
				"lang",
				"level",
				"why",
				"check"
			],
			"properties": {
				"id": { "$ref": "#/$defs/id" },
				"title": { "type": "string" },
				"by": { "type": "string" },
				"url": {
					"type": "string",
					"format": "uri",
					"pattern": "^https?://"
				},
				"type": { "enum": [
					"docs",
					"book",
					"course",
					"video",
					"article",
					"interactive",
					"exercises",
					"tool",
					"reference",
					"community"
				] },
				"cost": { "enum": [
					"free",
					"freemium",
					"paid"
				] },
				"price": {
					"type": "object",
					"additionalProperties": false,
					"required": [
						"amount",
						"currency",
						"seenOn"
					],
					"properties": {
						"amount": {
							"type": "number",
							"minimum": 0
						},
						"currency": {
							"type": "string",
							"pattern": "^[A-Z]{3}$"
						},
						"per": {
							"enum": [
								"once",
								"month",
								"year"
							],
							"default": "once"
						},
						"seenOn": { "$ref": "#/$defs/date" }
					}
				},
				"lang": { "$ref": "#/$defs/lang" },
				"level": { "$ref": "#/$defs/tier" },
				"minutes": {
					"type": "integer",
					"minimum": 1
				},
				"updated": {
					"type": "string",
					"description": "The source's own date, as printed on it. Never guessed."
				},
				"why": {
					"type": "string",
					"maxLength": 200,
					"description": "Why this is on the list, for this step."
				},
				"check": {
					"type": "object",
					"additionalProperties": false,
					"required": [
						"status",
						"on",
						"http"
					],
					"properties": {
						"status": { "enum": [
							"verified",
							"gated",
							"unverified"
						] },
						"on": { "$ref": "#/$defs/date" },
						"http": { "type": ["integer", "null"] },
						"note": { "type": "string" }
					},
					"if": { "properties": { "status": { "const": "verified" } } },
					"else": { "required": ["note"] }
				}
			}
		},
		"class": {
			"type": "object",
			"additionalProperties": false,
			"required": [
				"size",
				"sessionsPerWeek",
				"sessionMinutes"
			],
			"properties": {
				"size": {
					"type": "integer",
					"minimum": 1
				},
				"ages": { "type": "string" },
				"sessionsPerWeek": {
					"type": "number",
					"exclusiveMinimum": 0
				},
				"sessionMinutes": {
					"type": "integer",
					"minimum": 10
				},
				"weeks": {
					"type": "integer",
					"minimum": 1
				},
				"devices": { "enum": [
					"each",
					"shared",
					"teacher",
					"none"
				] },
				"assessment": {
					"type": "object",
					"additionalProperties": false,
					"required": ["mode"],
					"properties": {
						"mode": { "enum": [
							"none",
							"pass",
							"graded",
							"test"
						] },
						"note": { "type": "string" }
					}
				},
				"handout": {
					"enum": [
						"session",
						"stage",
						"none"
					],
					"default": "session"
				},
				"homework": {
					"type": "boolean",
					"default": false
				},
				"skipDates": {
					"type": "array",
					"items": { "$ref": "#/$defs/date" }
				},
				"sessions": {
					"type": "array",
					"items": {
						"type": "object",
						"additionalProperties": false,
						"required": [
							"n",
							"title",
							"inClass"
						],
						"properties": {
							"n": {
								"type": "integer",
								"minimum": 1
							},
							"date": { "$ref": "#/$defs/date" },
							"title": { "type": "string" },
							"opener": {
								"type": "string",
								"description": "A recall task from earlier sessions."
							},
							"inClass": { "$ref": "#/$defs/ids" },
							"homework": { "$ref": "#/$defs/ids" },
							"exit": {
								"type": "string",
								"description": "One question each student answers before leaving."
							},
							"materials": {
								"type": "array",
								"items": { "type": "string" }
							}
						}
					}
				}
			}
		}
	}
};
var PATTERN_HINTS = {
	"^[a-z0-9][a-z0-9-]{0,47}$": "must be an id: lowercase letters, digits and hyphens, starting with a letter or digit, at most 48 characters",
	"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$": "must be a language code such as \"en\" or \"de\"",
	"^[A-Z]{3}$": "must be a three-letter currency code such as \"EUR\"",
	"^https?://": "must be a web address starting with http:// or https://"
};
var SINGULAR = {
	stages: "stage",
	waypoints: "waypoint",
	resources: "resource",
	checks: "check",
	rungs: "rung",
	sessions: "session",
	show: "show item",
	options: "option",
	skipDates: "skip date",
	reviewDays: "review day",
	requires: "prerequisite",
	inClass: "class waypoint",
	homework: "homework waypoint",
	choices: "choice",
	criteria: "criterion",
	materials: "material",
	resourceLangs: "language",
	surfaces: "ground type",
	takeaways: "takeaway"
};
function pointer(...segments) {
	return segments.map((s) => `/${String(s).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}
function segmentsOf(path) {
	if (path === "") return [];
	return path.slice(1).split("/").map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
}
/** "/stages/1/waypoints/0/minutes" becomes `stage 2, waypoint 1, "minutes"`. */
function describePath(path) {
	const segs = segmentsOf(path);
	if (segs.length === 0) return "The roadmap";
	const parts = [];
	let props = [];
	const flush = () => {
		if (props.length > 0) parts.push(`"${props.join(".")}"`);
		props = [];
	};
	for (let i = 0; i < segs.length; i += 1) {
		const seg = segs[i];
		const next = segs[i + 1];
		if (next !== void 0 && /^\d+$/.test(next)) {
			flush();
			parts.push(`${SINGULAR[seg] ?? seg} ${Number(next) + 1}`);
			i += 1;
		} else props.push(seg);
	}
	flush();
	const text = parts.join(", ");
	return text.charAt(0).toUpperCase() + text.slice(1);
}
function typeWord(type) {
	switch (type) {
		case "string": return "text";
		case "number": return "a number";
		case "integer": return "a whole number";
		case "boolean": return "true or false";
		case "object": return "a group of fields in braces";
		case "array": return "a list in square brackets";
		case "null": return "null";
		default: return type;
	}
}
function kindOf(value) {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}
function matchesType(value, type) {
	switch (type) {
		case "string": return typeof value === "string";
		case "number": return typeof value === "number" && Number.isFinite(value);
		case "integer": return typeof value === "number" && Number.isInteger(value);
		case "boolean": return typeof value === "boolean";
		case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
		case "array": return Array.isArray(value);
		case "null": return value === null;
		default: return false;
	}
}
function show(value) {
	if (typeof value === "string") return `"${value.length > 40 ? `${value.slice(0, 40)}...` : value}"`;
	if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
	return kindOf(value);
}
function sameValue(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}
/** Edit distance, for "did you mean". */
function distance(a, b) {
	const row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i += 1) {
		let diagonal = row[0];
		row[0] = i;
		for (let j = 1; j <= b.length; j += 1) {
			const above = row[j];
			row[j] = Math.min(above + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
			diagonal = above;
		}
	}
	return row[b.length];
}
function closest(word, candidates) {
	let best = null;
	let bestDistance = Math.min(3, Math.max(1, Math.floor(word.length / 3)) + 1);
	for (const candidate of candidates) {
		const d = distance(word.toLowerCase(), candidate.toLowerCase());
		if (d < bestDistance) {
			best = candidate;
			bestDistance = d;
		}
	}
	return best;
}
var Checker = class Checker {
	root;
	issues = [];
	constructor(root) {
		this.root = root;
	}
	resolve(node) {
		if (!node.$ref) return node;
		const name = node.$ref.replace("#/$defs/", "");
		const target = this.root.$defs?.[name];
		if (!target) throw new Error(`roadmap.schema.json: unknown $ref ${node.$ref}`);
		return target;
	}
	add(path, problem) {
		this.issues.push({
			path,
			message: `${describePath(path)} ${problem}`
		});
	}
	check(node, value, path) {
		if (node.$ref) this.check(this.resolve(node), value, path);
		if ("const" in node && !sameValue(node.const, value)) {
			this.add(path, `must be ${show(node.const)}, but it is ${show(value)}.`);
			return;
		}
		if (node.enum && !node.enum.some((option) => sameValue(option, value))) {
			const list = node.enum.map((option) => `"${String(option)}"`).join(", ");
			this.add(path, `is ${show(value)}, but it must be one of: ${list}.`);
			return;
		}
		if (node.type !== void 0) {
			const types = typeof node.type === "string" ? [node.type] : node.type;
			if (!types.some((type) => matchesType(value, type))) {
				const wanted = types.map(typeWord).join(" or ");
				this.add(path, `must be ${wanted}, but it is ${value === null ? "null" : typeWord(kindOf(value))}.`);
				return;
			}
		}
		if (typeof value === "string") this.checkString(node, value, path);
		else if (typeof value === "number") this.checkNumber(node, value, path);
		else if (Array.isArray(value)) this.checkArray(node, value, path);
		else if (typeof value === "object" && value !== null) this.checkObject(node, value, path);
		if (node.anyOf && !node.anyOf.some((branch) => this.passes(branch, value, path))) {
			const typed = node.anyOf.filter((branch) => typeof branch.type === "string" && matchesType(value, branch.type));
			const only = typed.length === 1 ? typed[0] : void 0;
			if (only) this.check(only, value, path);
			else this.add(path, `is not valid. ${node.description ?? "It does not match any allowed form."}`);
		}
		if (node.if) {
			const branch = this.passes(node.if, value, path) ? node.then : node.else;
			if (branch) this.check(branch, value, path);
		}
	}
	passes(node, value, path) {
		const scratch = new Checker(this.root);
		scratch.check(node, value, path);
		return scratch.issues.length === 0;
	}
	checkString(node, value, path) {
		if (node.minLength !== void 0 && value.length < node.minLength) this.add(path, `is too short: at least ${node.minLength} characters.`);
		if (node.maxLength !== void 0 && value.length > node.maxLength) this.add(path, `is too long: ${value.length} characters, at most ${node.maxLength}.`);
		if (node.pattern !== void 0 && !new RegExp(node.pattern).test(value)) {
			this.add(path, `${PATTERN_HINTS[node.pattern] ?? `does not have the expected form (${node.pattern})`}, but it is ${show(value)}.`);
			return;
		}
		if (node.format === "date" && parseDay(value) === null) this.add(path, `must be a real calendar day written like 2026-11-13, but it is ${show(value)}.`);
		if (node.format === "uri") try {
			new URL(value);
		} catch {
			this.add(path, `is not a valid web address: ${show(value)}.`);
		}
	}
	checkNumber(node, value, path) {
		if (node.minimum !== void 0 && value < node.minimum) this.add(path, `must be at least ${node.minimum}, but it is ${value}.`);
		if (node.maximum !== void 0 && value > node.maximum) this.add(path, `must be at most ${node.maximum}, but it is ${value}.`);
		if (node.exclusiveMinimum !== void 0 && value <= node.exclusiveMinimum) this.add(path, `must be more than ${node.exclusiveMinimum}, but it is ${value}.`);
		if (node.exclusiveMaximum !== void 0 && value >= node.exclusiveMaximum) this.add(path, `must be less than ${node.exclusiveMaximum}, but it is ${value}.`);
	}
	checkArray(node, value, path) {
		if (node.minItems !== void 0 && value.length < node.minItems) this.add(path, `needs at least ${node.minItems} ${node.minItems === 1 ? "entry" : "entries"}, but has ${value.length}.`);
		if (node.maxItems !== void 0 && value.length > node.maxItems) this.add(path, `can have at most ${node.maxItems} entries, but has ${value.length}.`);
		if (node.uniqueItems) {
			const seen = /* @__PURE__ */ new Set();
			value.forEach((item, i) => {
				const key = JSON.stringify(item);
				if (seen.has(key)) this.add(pointer(...segmentsOf(path), i), `repeats an earlier entry (${show(item)}). Each entry may appear once.`);
				seen.add(key);
			});
		}
		if (node.items) {
			const items = node.items;
			value.forEach((item, i) => this.check(items, item, `${path}/${i}`));
		}
	}
	checkObject(node, value, path) {
		const own = (key) => `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
		for (const key of node.required ?? []) if (!(key in value)) this.add(own(key), "is missing. This field is required.");
		for (const [key, group] of Object.entries(node.dependentRequired ?? {})) {
			if (!(key in value)) continue;
			for (const needed of group) if (!(needed in value)) this.add(own(needed), `is missing. It is required whenever "${key}" is given.`);
		}
		const known = Object.keys(node.properties ?? {});
		for (const [key, child] of Object.entries(value)) {
			const schema = node.properties?.[key];
			if (schema) this.check(schema, child, own(key));
			else if (node.additionalProperties === false) {
				const guess = closest(key, known);
				this.add(own(key), `is not a field this roadmap understands.${guess ? ` Did you mean "${guess}"?` : " Check the spelling or remove it."}`);
			} else if (typeof node.additionalProperties === "object") this.check(node.additionalProperties, child, own(key));
		}
	}
};
/** Structural problems of `input` against the roadmap schema. Empty when the shape is right. */
function checkSchema(input) {
	const checker = new Checker(ROADMAP_SCHEMA);
	if (typeof input !== "object" || input === null || Array.isArray(input)) return [{
		path: "",
		message: "A roadmap must be one JSON object (a group of fields in braces)."
	}];
	checker.check(ROADMAP_SCHEMA, input, "");
	return checker.issues;
}
// src/scene/palette.ts
var PALETTE, SURFACE_KINDS, TIER_NAMES;
var init_palette = __esmMin((() => {
	PALETTE = {
		/** The room: deep blue-black, warmer near the lamp. */
		night: "#0b0f17",
		nightSoft: "#141b27",
		lamp: "#ffd9a0",
		/** Paper of the map sheets, the notes and the terrain layers. */
		paper: "#f3ece0",
		paperHi: "#fbf8f1",
		paperShade: "#d9cdb8",
		ink: "#1f2a3d",
		inkSoft: "#5a6577",
		/** The route, the pin and every "you are here". */
		signal: "#e2492f",
		signalDeep: "#b8341f",
		/** Compass metals and glass. */
		brass: "#c9a15b",
		brassDeep: "#8a6a32",
		steel: "#9aa3ad",
		glass: "#dfe9f2",
		/** Ground surfaces a roadmap can choose for its terrain bands. */
		surface: {
			water: "#7fb0c4",
			sand: "#e4cf9e",
			grass: "#9fbf86",
			forest: "#5f806b",
			dirt: "#b58a5a",
			scree: "#a8a296",
			rock: "#8e8a80",
			snow: "#f6f4ee"
		},
		/** Tier colours, from the first camp to the summit. */
		tier: {
			bronze: "#b8794a",
			silver: "#aeb6c0",
			gold: "#e0b44c",
			diamond: "#b9c8ff"
		}
	};
	SURFACE_KINDS = Object.keys(PALETTE.surface);
	TIER_NAMES = Object.keys(PALETTE.tier);
}));
// src/roadmap/validate.ts
/**
* Validation of a roadmap file: the schema (shape, types, unknown fields) first, then the rules a schema cannot
* express (ids, references, cycles, verified sources, practice share, dates). Errors make the file unusable,
* warnings are advice. Every message is written for a person, not for a program.
*/
init_palette();
/** A stage should hold at least this share of hands-on minutes. */
var MIN_STAGE_PRACTICE = .6;
/** The whole roadmap should reach this share. */
var MIN_TOTAL_PRACTICE = .7;
function validateRoadmap(input) {
	const shape = checkSchema(input);
	if (shape.length > 0) return {
		ok: false,
		errors: shape,
		warnings: []
	};
	const roadmap = input;
	const errors = [];
	const warnings = [];
	lint(roadmap, errors, warnings);
	if (errors.length > 0) return {
		ok: false,
		errors,
		warnings
	};
	return {
		ok: true,
		roadmap,
		warnings
	};
}
function lint(roadmap, errors, warnings) {
	const error = (path, text) => {
		errors.push({
			path,
			message: `${describePath(path)} ${text}`
		});
	};
	const warn = (path, text) => {
		warnings.push({
			path,
			message: `${describePath(path)} ${text}`
		});
	};
	const routeIds = /* @__PURE__ */ new Map();
	const claim = (id, path) => {
		const first = routeIds.get(id);
		if (first !== void 0) error(path, `reuses the id "${id}", which ${describePath(first.replace(/\/id$/, ""))} already has. Stage and waypoint ids must all be different.`);
		else routeIds.set(id, path);
	};
	roadmap.stages.forEach((stage, si) => {
		claim(stage.id, pointer("stages", si, "id"));
		stage.waypoints.forEach((waypoint, wi) => claim(waypoint.id, pointer("stages", si, "waypoints", wi, "id")));
	});
	const resourceIds = /* @__PURE__ */ new Map();
	roadmap.resources.forEach((resource, ri) => {
		const path = pointer("resources", ri, "id");
		const first = resourceIds.get(resource.id);
		if (first !== void 0) error(path, `reuses the id "${resource.id}", which ${describePath(first.replace(/\/id$/, ""))} already has. Resource ids must be different.`);
		else resourceIds.set(resource.id, path);
	});
	const stageIds = new Set(roadmap.stages.map((s) => s.id));
	const waypointIds = new Set(allWaypoints(roadmap).map((n) => n.waypoint.id));
	const resourceById = new Map(roadmap.resources.map((r) => [r.id, r]));
	const resolves = (id, known, path, noun, hint) => {
		if (known.has(id)) return true;
		const guess = closest(id, [...known]);
		const extra = hint?.(id) ?? (guess ? ` Did you mean "${guess}"?` : "");
		error(path, `points to "${id}", but there is no ${noun} with that id.${extra}`);
		return false;
	};
	const asStageHint = (id) => stageIds.has(id) ? " That is a stage id; waypoints can only wait for waypoints." : null;
	const asWaypointHint = (id) => waypointIds.has(id) ? " That is a waypoint id; stages can only wait for stages." : null;
	const checkMisses = (checks, base) => {
		checks?.forEach((check, ci) => {
			if (check.onMiss !== void 0) resolves(check.onMiss, waypointIds, `${base}/checks/${ci}/onMiss`, "waypoint");
			if (check.options && check.correct !== void 0 && check.correct >= check.options.length) error(`${base}/checks/${ci}/correct`, `is ${check.correct}, but there are only ${check.options.length} options (counting from 0).`);
		});
	};
	if (roadmap.brief.entry !== void 0) resolves(roadmap.brief.entry, stageIds, "/brief/entry", "stage", asWaypointHint);
	const usedResources = /* @__PURE__ */ new Set();
	roadmap.stages.forEach((stage, si) => {
		stage.requires?.forEach((id, k) => resolves(id, stageIds, pointer("stages", si, "requires", k), "stage", asWaypointHint));
		checkMisses(stage.checkpoint.checks, pointer("stages", si, "checkpoint"));
		stage.waypoints.forEach((waypoint, wi) => {
			const base = pointer("stages", si, "waypoints", wi);
			waypoint.requires?.forEach((id, k) => resolves(id, waypointIds, `${base}/requires/${k}`, "waypoint", asStageHint));
			waypoint.resources.forEach((id, k) => {
				if (resolves(id, new Set(resourceById.keys()), `${base}/resources/${k}`, "resource")) usedResources.add(id);
			});
			checkMisses(waypoint.checks, base);
		});
		stage.project?.resources?.forEach((id, k) => {
			if (resolves(id, new Set(resourceById.keys()), pointer("stages", si, "project", "resources", k), "resource")) usedResources.add(id);
		});
	});
	roadmap.class?.sessions?.forEach((session, ci) => {
		const base = pointer("class", "sessions", ci);
		session.inClass.forEach((id, k) => resolves(id, waypointIds, `${base}/inClass/${k}`, "waypoint", asStageHint));
		session.homework?.forEach((id, k) => resolves(id, waypointIds, `${base}/homework/${k}`, "waypoint", asStageHint));
	});
	findCycles(roadmap, error);
	roadmap.resources.forEach((resource, ri) => {
		if (!usedResources.has(resource.id)) error(pointer("resources", ri), `("${resource.id}") sits on the shelf, but no waypoint or project uses it. Use it in a step or remove it.`);
	});
	roadmap.stages.forEach((stage, si) => {
		stage.waypoints.forEach((waypoint, wi) => {
			if (!waypoint.resources.some((id) => resourceById.get(id)?.check.status === "verified") && !waypoint.gap) error(pointer("stages", si, "waypoints", wi, "resources"), `has no verified source and no "gap" note. Add a resource that was opened and read, or write a "gap" line that says no source could be verified.`);
			if (waypoint.practiceMinutes > waypoint.minutes) error(pointer("stages", si, "waypoints", wi, "practiceMinutes"), `is ${waypoint.practiceMinutes}, more than the whole step (${waypoint.minutes} minutes). Practice time is part of the step's time.`);
		});
	});
	let totalMinutes = 0;
	let totalPractice = 0;
	roadmap.stages.forEach((stage, si) => {
		const minutes = stage.waypoints.reduce((sum, w) => sum + w.minutes, 0);
		const practice = stage.waypoints.reduce((sum, w) => sum + Math.min(w.practiceMinutes, w.minutes), 0);
		totalMinutes += minutes;
		totalPractice += practice;
		if (practice < minutes * .6 - 1e-9) warn(pointer("stages", si), `("${stage.title}") has only ${Math.round(practice / minutes * 100)} percent hands-on time. Aim for at least ${MIN_STAGE_PRACTICE * 100} percent: more doing, less reading.`);
	});
	if (totalMinutes > 0 && totalPractice < totalMinutes * .7 - 1e-9) warnings.push({
		path: "/stages",
		message: `Across all stages only ${Math.round(totalPractice / totalMinutes * 100)} percent of the time is hands-on. Aim for at least ${MIN_TOTAL_PRACTICE * 100} percent.`
	});
	const { startDate, deadline } = roadmap.brief;
	if (startDate !== void 0 && deadline !== void 0) {
		const start = parseDay(startDate);
		const end = parseDay(deadline);
		if (start !== null && end !== null && end <= start) error("/brief/deadline", `(${deadline}) must be after the start date (${startDate}).`);
	}
	if (roadmap.class?.sessions) {
		const dated = roadmap.class.sessions.map((s, i) => ({
			date: s.date,
			i
		})).filter((s) => s.date !== void 0);
		for (let k = 1; k < dated.length; k += 1) {
			const before = dated[k - 1];
			const now = dated[k];
			if (before && now && daysBetween(before.date, now.date) < 0) warn(pointer("class", "sessions", now.i, "date"), `(${now.date}) is earlier than the session before it (${before.date}).`);
		}
	}
	let highest = -1;
	roadmap.stages.forEach((stage, si) => {
		const rank = TIER_NAMES.indexOf(stage.tier);
		if (rank < highest) warn(pointer("stages", si, "tier"), `is ${stage.tier}, lower than an earlier stage. The route should only climb.`);
		highest = Math.max(highest, rank);
	});
	const topTier = TIER_NAMES[Math.max(highest, 0)];
	if (topTier !== void 0 && topTier !== roadmap.brief.targetTier) warn("/brief/targetTier", `is ${roadmap.brief.targetTier}, but the last stage reaches ${topTier}. The summit and the goal should match.`);
	if (roadmap.resources.length > 45) warn("/resources", `has ${roadmap.resources.length} entries. More than 45 is too many to be checked and read.`);
	roadmap.resources.forEach((resource, ri) => {
		const { status, http } = resource.check;
		if (status === "verified" && (http === null || http < 200 || http > 299)) warn(pointer("resources", ri, "check", "http"), `is ${http === null ? "empty" : http}, but the source is marked verified. Verified means it opened with a success status.`);
		if (resource.cost === "free" && resource.price !== void 0) warn(pointer("resources", ri, "price"), "is given, but the resource is marked free.");
	});
	if (roadmap.brief.audience === "teacher" && roadmap.class === void 0) warn("/class", "is missing. A roadmap for a teacher normally describes the class.");
}
/** Depth-first search over the "waits for" graph. Each cycle is reported once, at the entry that closes it. */
function findCycles(roadmap, error) {
	const stageEdges = /* @__PURE__ */ new Map();
	roadmap.stages.forEach((stage, si) => {
		const explicit = stage.requires !== void 0;
		const edges = stageRequires(roadmap, si).filter((id) => roadmap.stages.some((s) => s.id === id)).map((to, k) => ({
			to,
			path: explicit ? pointer("stages", si, "requires", k) : pointer("stages", si)
		}));
		stageEdges.set(stage.id, edges);
	});
	const stageCycles = walk(stageEdges, "stage", error);
	const waypointEdges = /* @__PURE__ */ new Map();
	const mainWaypointsOf = new Map(roadmap.stages.map((s) => [s.id, s.waypoints.filter((w) => !w.optional).map((w) => w.id)]));
	roadmap.stages.forEach((stage, si) => {
		stage.waypoints.forEach((waypoint, wi) => {
			const base = pointer("stages", si, "waypoints", wi);
			const explicit = waypoint.requires !== void 0;
			const edges = waypointRequires(stage, wi).filter((id) => !roadmap.stages.some((s) => s.id === id)).map((to, k) => ({
				to,
				path: explicit ? `${base}/requires/${k}` : base
			}));
			if (!stageCycles) stageRequires(roadmap, si).forEach((stageId, k) => {
				for (const to of mainWaypointsOf.get(stageId) ?? []) edges.push({
					to,
					path: stage.requires ? pointer("stages", si, "requires", k) : pointer("stages", si)
				});
			});
			waypointEdges.set(waypoint.id, edges);
		});
	});
	walk(waypointEdges, "step", error);
}
function walk(graph, noun, error) {
	const state = /* @__PURE__ */ new Map();
	const stack = [];
	const taken = [];
	let found = false;
	const visit = (id) => {
		state.set(id, "open");
		stack.push(id);
		for (const edge of graph.get(id) ?? []) {
			const seen = state.get(edge.to);
			if (seen === "open") {
				found = true;
				const from = stack.indexOf(edge.to);
				const loop = [...stack.slice(from), edge.to].map((x) => `"${x}"`).join(" → ");
				error(([...taken.slice(from), edge].find((e) => e.path.includes("/requires/")) ?? edge).path, `is part of a circle of ${noun}s that wait for each other: ${loop}. Remove one of the prerequisites so the route has a start.`);
			} else if (seen === void 0) {
				taken.push(edge);
				visit(edge.to);
				taken.pop();
			}
		}
		stack.pop();
		state.set(id, "done");
	};
	for (const id of graph.keys()) if (!state.has(id)) visit(id);
	return found;
}
// src/roadmap/share.ts
/** Longest fragment this module writes or reads, in characters. */
var MAX_FRAGMENT_LENGTH = 6e4;
/** Longest roadmap JSON accepted after decompression, in bytes. Stops a tiny link from inflating without bound. */
var MAX_JSON_BYTES = 2e6;
var ShareTooLargeError = class extends Error {
	length;
	limit;
	constructor(length, limit) {
		super(`This roadmap is too large to share as a link: it needs ${length.toLocaleString("en-US")} characters and a link can carry ${limit.toLocaleString("en-US")}. Share the roadmap file instead, or remove some waypoints.`);
		this.name = "ShareTooLargeError";
		this.length = length;
		this.limit = limit;
	}
};
var encoder = new TextEncoder();
new TextDecoder("utf-8", { fatal: true });
function toBase64Url(bytes) {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function streamOf(bytes) {
	return new ReadableStream({ start(controller) {
		controller.enqueue(bytes);
		controller.close();
	} });
}
async function collect(stream, limit) {
	const reader = stream.getReader();
	const chunks = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.length;
		if (size > limit) {
			await reader.cancel();
			throw new Error("The link unpacks to something far larger than any roadmap, so it was not opened.");
		}
		chunks.push(value);
	}
	const out = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}
/** True when this environment can compress and decompress links. */
function canCompress() {
	return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}
async function deflate(bytes) {
	return collect(streamOf(bytes).pipeThrough(new CompressionStream("deflate-raw")), MAX_JSON_BYTES);
}
/**
* The text to put after `#` in a link. Throws `ShareTooLargeError` past `MAX_FRAGMENT_LENGTH` characters.
* The roadmap is written as it is: remove teacher-only parts before sharing with students.
*/
async function encodeRoadmap(roadmap) {
	const json = encoder.encode(JSON.stringify(roadmap));
	const fragment = canCompress() ? `z1.${toBase64Url(await deflate(json))}` : `j1.${toBase64Url(json)}`;
	if (fragment.length > 6e4) throw new ShareTooLargeError(fragment.length, MAX_FRAGMENT_LENGTH);
	return fragment;
}
// src/cli/issues.ts
/**
* Loading a roadmap file and printing what the validator found, with each problem's JSON pointer.
*/
function loadRoadmap(path) {
	const data = readJsonFile(path, "roadmap file");
	return {
		path,
		data,
		result: validateRoadmap(data)
	};
}
function plural(n, word) {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}
function issueList(heading, issues) {
	if (issues.length === 0) return [];
	const lines = ["", `${heading} (${issues.length})`];
	issues.forEach((issue, i) => {
		lines.push(`  ${i + 1}. at ${issue.path === "" ? "/ (the whole file)" : issue.path}`);
		lines.push(`     ${issue.message}`);
	});
	return lines;
}
/** A short report: one summary line, then every error and warning with its pointer. */
function formatValidation(path, result) {
	const name = basename(path);
	const errors = result.ok ? [] : result.errors;
	const { warnings } = result;
	return [
		result.ok ? warnings.length === 0 ? `${name} is a valid zero-to roadmap.` : `${name} is a valid zero-to roadmap, with ${plural(warnings.length, "warning")}.` : `${name} has ${plural(errors.length, "error")} and ${plural(warnings.length, "warning")}. Fix the errors before building.`,
		...issueList("Errors", errors),
		...issueList("Warnings", warnings)
	].join("\n");
}
/** The roadmap when it validates; otherwise a CliError that carries the full report. */
function requireValid(loaded, action) {
	if (!loaded.result.ok) throw new CliError(`${formatValidation(loaded.path, loaded.result)}\n\nNothing was ${action}.`, 1);
	return {
		roadmap: loaded.result.roadmap,
		warnings: loaded.result.warnings
	};
}
/** Bytes of a page read for its title and the heuristics. */
var MAX_BODY_BYTES = 1e6;
var TRACKING = /^(utm_[a-z_]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|_ga|_gl|mkt_tok)$/i;
var YOUTUBE_HOSTS = /* @__PURE__ */ new Set([
	"youtube.com",
	"www.youtube.com",
	"m.youtube.com",
	"music.youtube.com",
	"youtu.be",
	"www.youtu.be"
]);
/** The address without tracking parameters (and without YouTube's share marker). Unparseable text is returned as is. */
function stripTracking(address) {
	let url;
	try {
		url = new URL(address);
	} catch {
		return address;
	}
	const youtube = YOUTUBE_HOSTS.has(url.hostname);
	for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key) || youtube && (key === "si" || key === "feature")) url.searchParams.delete(key);
	return url.href;
}
/** True for a single YouTube video address (watch, youtu.be, shorts, live, embed). */
function isYouTubeVideo(address) {
	let url;
	try {
		url = new URL(address);
	} catch {
		return false;
	}
	if (!YOUTUBE_HOSTS.has(url.hostname)) return false;
	if (url.hostname.endsWith("youtu.be")) return /^\/[\w-]{6,}/.test(url.pathname);
	if (url.pathname === "/watch") return url.searchParams.has("v");
	return /^\/(shorts|live|embed)\/[\w-]{6,}/.test(url.pathname);
}
function oembedUrl(address) {
	return `https://www.youtube.com/oembed?url=${encodeURIComponent(stripTracking(address))}&format=json`;
}
var ENTITIES = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: "\"",
	apos: "'",
	nbsp: " ",
	ndash: "–",
	mdash: "—",
	middot: "·",
	hellip: "…",
	laquo: "«",
	raquo: "»",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“"
};
function decodeEntities(text) {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
		if (name[0] === "#") {
			const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 1114111 ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[name.toLowerCase()] ?? whole;
	});
}
function clean(text) {
	return decodeEntities(text.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
/** The page's <title>, cleaned, or null. */
function pageTitle(html) {
	const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
	if (!match || match[1] === void 0) return null;
	const title = clean(match[1]);
	return title === "" ? null : title.slice(0, 300);
}
function firstHeading(html) {
	const match = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html);
	return match?.[1] === void 0 ? null : clean(match[1]);
}
var NOT_FOUND = /(^|\W)(404|error 404|404 error|404 not found|page not found|not found|file not found|page (?:does not|doesn['’]t) exist|this page (?:does not|doesn['’]t|no longer) exists?|no longer available|could not be found|cannot be found|can['’]t be found|seite nicht gefunden|nicht gefunden|page introuvable|página no encontrada|pagina non trovata)(\W|$)/i;
var NOT_FOUND_STRONG = /^(?:error\s*)?404\b|^(?:page|file)?\s*not found\b|\bpage not found\b|\b404 not found\b|seite nicht gefunden|page introuvable|página no encontrada|^(?:this )?page (?:does not|doesn['’]t|no longer) exists?\b/i;
var PARKED = /(this domain|the domain|domain name)[^<]{0,80}?(is|may be) for sale|buy this domain|domain (?:is )?for sale|this domain is parked|parked (?:free|domain)|domain parking|sedoparking|parkingcrew|bodis\.com|hugedomains|afternic|dan\.com\/buy-domain/i;
var PARKING_HOSTS = /(^|\.)(sedo\.com|dan\.com|afternic\.com|hugedomains\.com|parkingcrew\.net|bodis\.com|undeveloped\.com|sav\.com|domainmarket\.com)$/i;
var PAYWALL = /(subscribe|subscription) (now )?to (continue|keep) reading|to continue reading,? (please )?(subscribe|sign in|log in)|this (article|content|story|post) is (only )?(available|reserved) (only )?(to|for) (paid )?(subscribers|members)|member-only story|members[- ]only (content|story|article|post)|become a (paid )?member to (read|continue|access)|you(['’]ve| have) reached your (free )?(article|story|monthly) limit|purchase (this course|to unlock|access to this)|unlock (this|the full) (course|article|lesson|story)|enrol(l)?(ment)? (is )?required to (view|access)|sign in to (continue|read|view|access) (this|the) (course|lesson|article|content)|log in to (continue|read|view|access) (this|the) (course|lesson|article|content)/i;
var LOGIN_FORM = /<input\b[^>]*\btype\s*=\s*["']?password\b/i;
var LOGIN_PATH = /(^|\/)(login|log-in|log_in|signin|sign-in|sign_in|sso|auth|oauth2?|authorize|session\/new|users\/sign_in|accounts?\/login)(\/|$)/i;
var LOGIN_HOST = /^(login|signin|accounts?|auth|sso|id)\./i;
var BOT_CHECK = /just a moment\.\.\.|attention required! \| cloudflare|cf-chl-|challenge-platform|verify (that )?you are (a )?human|are you a robot|captcha-delivery|px-captcha|enable javascript and cookies to continue/i;
function readSigns(html) {
	const title = pageTitle(html);
	const heading = firstHeading(html);
	const head = html.slice(0, 2e5);
	const notFound = title !== null && NOT_FOUND_STRONG.test(title) || heading !== null && heading.length < 80 && NOT_FOUND.test(heading) && (title === null || NOT_FOUND.test(title));
	return {
		title,
		parked: PARKED.test(head),
		notFound,
		paywall: PAYWALL.test(head),
		loginForm: LOGIN_FORM.test(head),
		botCheck: BOT_CHECK.test(head) || title !== null && /^just a moment/i.test(title)
	};
}
function isLoginAddress(address) {
	try {
		const url = new URL(address);
		return LOGIN_HOST.test(url.hostname) || LOGIN_PATH.test(url.pathname);
	} catch {
		return false;
	}
}
function isParkingHost(address) {
	try {
		return PARKING_HOSTS.test(new URL(address).hostname);
	} catch {
		return false;
	}
}
/** A deep link that ended on the site's front page, which usually means the page was removed. */
function landedOnHome(from, to) {
	try {
		const a = new URL(from);
		const b = new URL(to);
		const deep = a.pathname.replace(/\/+$/, "").length > 0;
		const home = b.pathname === "/" || b.pathname === "" || /^\/[a-z]{2}(-[a-z]{2})?\/?$/i.test(b.pathname);
		return deep && home && b.search === "";
	} catch {
		return false;
	}
}
function sameAddress(a, b) {
	const norm = (s) => s.replace(/\/+$/, "").replace(/^http:/, "https:");
	return norm(stripTracking(a)) === norm(stripTracking(b));
}
async function readBody(response, limit) {
	if (!response.body) return {
		text: "",
		bytes: 0,
		complete: true
	};
	const reader = response.body.getReader();
	const chunks = [];
	let bytes = 0;
	let complete = true;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		bytes += value.length;
		if (bytes >= limit) {
			complete = false;
			await reader.cancel().catch(() => void 0);
			break;
		}
	}
	const all = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		all.set(chunk, offset);
		offset += chunk.length;
	}
	return {
		text: new TextDecoder("utf-8").decode(all),
		bytes,
		complete
	};
}
async function discard(response) {
	await response.body?.cancel().catch(() => void 0);
}
function isTextual(contentType) {
	if (contentType === null || contentType === "") return true;
	return /text\/|html|xml|json/i.test(contentType);
}
function judgeError(error, timedOut) {
	const code = errorCode(error);
	const name = error instanceof Error || error instanceof DOMException ? error.name : "";
	if (timedOut || name === "TimeoutError" || name === "AbortError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "ETIMEDOUT") return {
		outcome: "unverified",
		flags: ["timeout"],
		reason: "No answer within the time limit."
	};
	if (code === "ENOTFOUND") return {
		outcome: "dead",
		flags: ["dns"],
		reason: "The domain has no DNS record: it does not exist (any more)."
	};
	if (code === "EAI_AGAIN") return {
		outcome: "unverified",
		flags: ["dns-retry"],
		reason: "The DNS lookup failed for now. Try again later."
	};
	if (code !== null && /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return {
		outcome: "unverified",
		flags: ["tls"],
		reason: `The site's security certificate was refused (${code}).`
	};
	if (code === "ECONNREFUSED") return {
		outcome: "unverified",
		flags: ["refused"],
		reason: "The server refused the connection."
	};
	return {
		outcome: "unverified",
		flags: ["network"],
		reason: `The connection failed (${code ?? (error instanceof Error ? error.message : String(error))}).`
	};
}
function errorCode(error) {
	let current = error;
	for (let depth = 0; depth < 4 && current !== null && typeof current === "object"; depth += 1) {
		const code = current.code;
		if (typeof code === "string") return code;
		current = current.cause;
	}
	return null;
}
function judgePage(status, requested, finalUrl, signs) {
	const flags = [];
	if (status === 404) return {
		outcome: "dead",
		flags: ["not-found"],
		reason: "The page is not there (HTTP 404)."
	};
	if (status === 410) return {
		outcome: "dead",
		flags: ["gone"],
		reason: "The page was removed (HTTP 410)."
	};
	if (signs?.botCheck) return {
		outcome: "unverified",
		flags: ["bot-check"],
		reason: `A bot check stopped the automatic visit (HTTP ${status}).`
	};
	if (status === 401) return {
		outcome: "gated",
		flags: ["login"],
		reason: "It needs a login (HTTP 401)."
	};
	if (status === 402) return {
		outcome: "gated",
		flags: ["paywall"],
		reason: "It needs a payment (HTTP 402)."
	};
	if (status === 403) {
		if (signs?.loginForm) return {
			outcome: "gated",
			flags: ["login"],
			reason: "It answered with a login form (HTTP 403)."
		};
		if (signs?.paywall) return {
			outcome: "gated",
			flags: ["paywall"],
			reason: "It answered with a paywall (HTTP 403)."
		};
		return {
			outcome: "unverified",
			flags: ["refused"],
			reason: "The site refused the automatic visit (HTTP 403)."
		};
	}
	if (status === 429) return {
		outcome: "unverified",
		flags: ["rate-limited"],
		reason: "The site asked to slow down (HTTP 429)."
	};
	if (status >= 500) return {
		outcome: "unverified",
		flags: ["server-error"],
		reason: `The server had an error (HTTP ${status}).`
	};
	if (status >= 400) return {
		outcome: "unverified",
		flags: ["http-error"],
		reason: `The site answered with an error (HTTP ${status}).`
	};
	if (status < 200 || status >= 300) return {
		outcome: "unverified",
		flags: ["odd-status"],
		reason: `The site answered with HTTP ${status} and no page.`
	};
	if (isParkingHost(finalUrl) || signs?.parked) return {
		outcome: "dead",
		flags: ["parked"],
		reason: "The domain is parked or for sale."
	};
	if (signs?.notFound) return {
		outcome: "dead",
		flags: ["soft-404"],
		reason: `The page says it was not found, although it answered ${status}.`
	};
	if (!sameAddress(requested, finalUrl) && isLoginAddress(finalUrl) && !isLoginAddress(requested)) return {
		outcome: "gated",
		flags: ["login"],
		reason: "It redirected to a login page."
	};
	if (signs?.paywall) return {
		outcome: "gated",
		flags: ["paywall"],
		reason: "The page shows paywall or members-only wording."
	};
	if (landedOnHome(requested, finalUrl) && !sameAddress(requested, finalUrl)) return {
		outcome: "unverified",
		flags: ["home-redirect"],
		reason: "It redirected to the front page, which often means the page was removed."
	};
	if (!sameAddress(requested, finalUrl)) flags.push("moved");
	if (signs?.loginForm) flags.push("login-form");
	return {
		outcome: "kept",
		flags,
		reason: `It answered ${status}.`
	};
}
function judgeOembed(status) {
	if (status === 200) return {
		outcome: "kept",
		flags: ["youtube"],
		reason: "YouTube knows the video (oEmbed 200)."
	};
	if (status === 404) return {
		outcome: "dead",
		flags: ["youtube", "not-found"],
		reason: "YouTube does not know this video (oEmbed 404)."
	};
	if (status === 400) return {
		outcome: "dead",
		flags: ["youtube", "bad-address"],
		reason: "YouTube does not read this as a video address (oEmbed 400)."
	};
	if (status === 401 || status === 403) return {
		outcome: "unverified",
		flags: ["youtube", "private"],
		reason: `YouTube would not describe the video: it may be private or not embeddable (oEmbed ${status}).`
	};
	if (status === 429) return {
		outcome: "unverified",
		flags: ["youtube", "rate-limited"],
		reason: "YouTube asked to slow down (HTTP 429)."
	};
	return {
		outcome: "unverified",
		flags: ["youtube", "http-error"],
		reason: `The YouTube lookup answered HTTP ${status}.`
	};
}
/** Opens one address and judges it. Never throws. */
async function checkUrl(resourceId, url, options) {
	const clock = options.clock ?? Date.now;
	const started = clock();
	const timeoutMs = options.timeoutMs ?? 15e3;
	const maxRedirects = options.maxRedirects ?? 5;
	const youtube = isYouTubeVideo(url);
	const fetched = youtube ? oembedUrl(url) : url;
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort(new DOMException("The check took too long.", "TimeoutError"));
	}, timeoutMs);
	const headers = {
		"user-agent": options.userAgent ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		accept: youtube ? "application/json" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"accept-language": "en;q=0.9,*;q=0.5"
	};
	let current = fetched;
	let redirects = 0;
	let http = null;
	const finish = (verdict, extra = {}) => ({
		resourceId,
		url,
		fetched,
		finalUrl: extra.finalUrl === void 0 ? http === null ? null : stripTracking(youtube ? url : current) : extra.finalUrl,
		http,
		title: extra.title ?? null,
		contentLength: extra.contentLength ?? null,
		redirects,
		outcome: verdict.outcome,
		flags: verdict.flags,
		reason: verdict.reason,
		ms: Math.max(0, Math.round(clock() - started))
	});
	try {
		for (;;) {
			const response = await options.fetch(current, {
				method: "GET",
				redirect: "manual",
				headers,
				signal: controller.signal
			});
			http = response.status;
			const location = response.headers.get("location");
			if (http >= 300 && http < 400 && location !== null) {
				await discard(response);
				if (redirects >= maxRedirects) return finish({
					outcome: "unverified",
					flags: ["too-many-redirects"],
					reason: `It redirected more than ${maxRedirects} times.`
				});
				current = new URL(location, current).href;
				redirects += 1;
				continue;
			}
			const lengthHeader = response.headers.get("content-length");
			const declared = lengthHeader !== null && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
			if (youtube) {
				const body = await readBody(response, 64e3);
				let title = null;
				if (http === 200) try {
					const meta = JSON.parse(body.text);
					title = typeof meta.title === "string" ? meta.title : null;
				} catch {
					title = null;
				}
				return finish(judgeOembed(http), {
					title,
					contentLength: declared ?? (body.complete ? body.bytes : null),
					finalUrl: stripTracking(url)
				});
			}
			if (!isTextual(response.headers.get("content-type"))) {
				await discard(response);
				return finish(judgePage(http, url, current, null), { contentLength: declared });
			}
			const body = await readBody(response, MAX_BODY_BYTES);
			const signs = readSigns(body.text);
			return finish(judgePage(http, url, current, signs), {
				title: signs.title,
				contentLength: declared ?? (body.complete ? body.bytes : null)
			});
		}
	} catch (error) {
		http = null;
		return finish(judgeError(error, timedOut), { finalUrl: null });
	} finally {
		clearTimeout(timer);
	}
}
/** Runs `work` over `items` with at most `limit` at once, keeping the order of the results. */
async function mapLimit(items, limit, work) {
	const results = new Array(items.length);
	let next = 0;
	const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			results[index] = await work(items[index], index);
		}
	});
	await Promise.all(lanes);
	return results;
}
/** Checks every resource. Two resources with the same address share one fetch. */
async function checkResources(resources, options) {
	const unique = [...new Set(resources.map((r) => r.url))];
	let done = 0;
	const byUrl = /* @__PURE__ */ new Map();
	await mapLimit(unique, options.concurrency ?? 4, async (url) => {
		const result = await checkUrl(resources.find((r) => r.url === url)?.id ?? "", url, options);
		byUrl.set(url, result);
		for (const r of resources) if (r.url === url) {
			done += 1;
			options.onResult?.({
				...result,
				resourceId: r.id
			}, done, resources.length);
		}
	});
	return resources.map((r) => ({
		...byUrl.get(r.url),
		resourceId: r.id
	}));
}
function totalsOf(results) {
	const count = (o) => results.filter((r) => r.outcome === o).length;
	return {
		opened: results.length,
		kept: count("kept"),
		dead: count("dead"),
		flagged: count("gated") + count("unverified")
	};
}
function formatTotals(totals) {
	return `${totals.opened} opened, ${totals.kept} kept, ${totals.dead} dead, ${totals.flagged} flagged`;
}
/** The note written for a 200 that was not read: the tool never claims what it did not read. */
var REACHABLE_NOTE = "reachable, read it before marking verified";
/**
* The `check` a result leads to. A success keeps "verified" only when the resource was verified before, or when
* `trust200` is set; otherwise the resource stays as it was with a note that it is reachable but unread.
* Dead links are written as unverified with the reason, so nothing is deleted and the agent decides.
*/
function nextCheck(previous, result, today, trust200) {
	const http = result.http;
	const before = previous?.status;
	switch (result.outcome) {
		case "kept":
			if (before === "verified" || trust200) return before === "verified" && previous?.note !== void 0 ? {
				status: "verified",
				on: today,
				http,
				note: previous?.note
			} : {
				status: "verified",
				on: today,
				http
			};
			if (before === "gated" && previous?.note !== void 0) return {
				status: "gated",
				on: today,
				http,
				note: previous.note
			};
			return {
				status: "unverified",
				on: today,
				http,
				note: `Reachable on ${today} (HTTP ${http ?? "none"}), but not read yet. Read it before marking it verified.`
			};
		case "dead": return {
			status: "unverified",
			on: today,
			http,
			note: `Dead on ${today}: ${result.reason} Replace or remove this resource.`
		};
		case "gated":
			if (before === "gated" && previous?.note !== void 0) return {
				status: "gated",
				on: today,
				http,
				note: previous.note
			};
			return {
				status: "gated",
				on: today,
				http,
				note: `Behind a login or paywall when opened on ${today}: ${result.reason}`
			};
		case "unverified": return {
			status: "unverified",
			on: today,
			http,
			note: `Could not be opened on ${today} (${http === null ? result.reason.replace(/\.$/, "").toLowerCase() : `HTTP ${http}`}). Open it yourself before relying on it.`
		};
	}
}
/** What the table says about a kept link the tool may not mark verified. */
function keptDetail(result, previous, trust200) {
	const parts = [];
	if (previous !== "verified" && !trust200) parts.push(previous === "gated" ? "reachable, still gated" : REACHABLE_NOTE);
	if (result.flags.includes("moved") && result.finalUrl !== null) parts.push(`moved to ${result.finalUrl}`);
	if (result.title !== null) parts.push(result.title);
	return parts.join(" · ");
}
// src/cli/student.ts
var LETTERS = "ABCDE";
function withhold(check) {
	const { answer: _answer, correct: _correct, options, ...rest } = check;
	if (options === void 0) return {
		...rest,
		answer: ""
	};
	const listed = options.map((option, i) => `${LETTERS[i] ?? String(i + 1)}) ${option}`).join("\n");
	return {
		...rest,
		q: `${check.q}\n${listed}`,
		answer: ""
	};
}
function studentCopy(roadmap) {
	const mode = roadmap.class?.assessment?.mode;
	const assessCheckpoints = mode !== "none";
	const assessWaypoints = mode === "test";
	let teacherNotes = 0;
	let answers = 0;
	const strip = (checks, assessed) => {
		if (checks === void 0 || !assessed) return checks;
		answers += checks.length;
		return checks.map(withhold);
	};
	const stages = roadmap.stages.map((stage) => {
		const waypoints = stage.waypoints.map((waypoint) => {
			const { teacherNote, checks, ...rest } = waypoint;
			if (teacherNote !== void 0) teacherNotes += 1;
			const kept = strip(checks, assessWaypoints);
			return kept === void 0 ? rest : {
				...rest,
				checks: kept
			};
		});
		const { checks, ...checkpoint } = stage.checkpoint;
		const kept = strip(checks, assessCheckpoints);
		return {
			...stage,
			waypoints,
			checkpoint: kept === void 0 ? checkpoint : {
				...checkpoint,
				checks: kept
			}
		};
	});
	let sessions = 0;
	let plan;
	if (roadmap.class !== void 0) {
		const { sessions: list, ...rest } = roadmap.class;
		sessions = list?.length ?? 0;
		plan = rest;
	}
	const { class: _class, ...base } = roadmap;
	const copy = plan === void 0 ? {
		...base,
		stages
	} : {
		...base,
		stages,
		class: plan
	};
	return {
		roadmap: structuredClone(copy),
		removed: {
			teacherNotes,
			sessions,
			answers
		}
	};
}
/** True when sharing this roadmap as it is would hand teacher-only parts to students. */
function hasTeacherParts(roadmap) {
	if ((roadmap.class?.sessions?.length ?? 0) > 0) return true;
	return roadmap.stages.some((s) => s.waypoints.some((w) => w.teacherNote !== void 0));
}
// src/cli/viewer.ts
var ROADMAP_ELEMENT_ID = "zero-to-roadmap";
var RECEIPT_ELEMENT_ID = "zero-to-receipt";
var TITLE_SUFFIX = " · zero-to";
var ViewerTemplateError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "ViewerTemplateError";
	}
};
var RAW_TEXT = /* @__PURE__ */ new Set([
	"script",
	"style",
	"textarea",
	"title"
]);
function attribute(attrs, name) {
	const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
	if (!match) return null;
	return match[1] ?? match[2] ?? match[3] ?? "";
}
/** Index just after the ">" that closes the tag starting at `from`, respecting quoted attribute values. */
function tagEnd(html, from) {
	let quote = null;
	for (let i = from; i < html.length; i += 1) {
		const c = html[i];
		if (quote !== null) {
			if (c === quote) quote = null;
		} else if (c === "\"" || c === "'") quote = c;
		else if (c === ">") return i + 1;
	}
	return -1;
}
/** The raw-text elements of a page (script, style, textarea, title), in document order. */
function rawTextElements(html) {
	const found = [];
	let i = 0;
	while (i < html.length) {
		const lt = html.indexOf("<", i);
		if (lt < 0) break;
		if (html.startsWith("<!--", lt)) {
			const close = html.indexOf("-->", lt + 4);
			i = close < 0 ? html.length : close + 3;
			continue;
		}
		const open = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, lt + 64));
		if (!open || open[1] === void 0) {
			i = lt + 1;
			continue;
		}
		const name = open[1].toLowerCase();
		const contentStart = tagEnd(html, lt + open[0].length);
		if (contentStart < 0) break;
		if (!RAW_TEXT.has(name)) {
			i = contentStart;
			continue;
		}
		const closer = new RegExp(`</${name}[\\s/>]`, "gi");
		closer.lastIndex = contentStart;
		const close = closer.exec(html);
		const contentEnd = close ? close.index : html.length;
		const end = close ? tagEnd(html, close.index) : html.length;
		const attrs = html.slice(lt + open[0].length, contentStart - 1);
		found.push({
			name,
			id: attribute(attrs, "id"),
			start: lt,
			contentStart,
			contentEnd,
			end: end < 0 ? html.length : end
		});
		i = end < 0 ? html.length : end;
	}
	return found;
}
var BACKSLASH = String.fromCharCode(92);
var LINE_BREAKS = new RegExp(`[${String.fromCharCode(8232)}${String.fromCharCode(8233)}]`, "g");
/** "<" as a JSON escape: backslash, u, 003c. */
var ESCAPED_LT = `${BACKSLASH}u003c`;
/**
* JSON that is safe inside a <script> element: every "<" becomes the escape backslash-u-003c, so no "<\/script>"
* can close the element early. The two Unicode line separators are escaped as well.
*/
function scriptJson(value) {
	return JSON.stringify(value).replace(/</g, ESCAPED_LT).replace(LINE_BREAKS, (c) => `${BACKSLASH}u${c.charCodeAt(0).toString(16)}`);
}
function escapeHtmlText(text) {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function applySplices(html, splices) {
	let out = html;
	for (const s of [...splices].sort((a, b) => b.from - a.from)) out = out.slice(0, s.from) + s.text + out.slice(s.to);
	return out;
}
/** Fills the template. Throws ViewerTemplateError when the template has no roadmap element. */
function injectRoadmap(template, roadmap, receipt) {
	const elements = rawTextElements(template);
	const holder = elements.find((e) => e.name === "script" && e.id === "zero-to-roadmap");
	if (!holder) throw new ViewerTemplateError(`The viewer template has no <script type="application/json" id="${ROADMAP_ELEMENT_ID}"> element, so it is not a zero-to viewer build.`);
	const splices = [{
		from: holder.contentStart,
		to: holder.contentEnd,
		text: scriptJson(roadmap)
	}];
	if (receipt !== void 0) {
		const counts = {
			opened: receipt.opened,
			kept: receipt.kept,
			dead: receipt.dead,
			flagged: receipt.flagged,
			checkedOn: receipt.checkedOn
		};
		const slot = elements.find((e) => e.name === "script" && e.id === "zero-to-receipt");
		if (slot) splices.push({
			from: slot.contentStart,
			to: slot.contentEnd,
			text: scriptJson(counts)
		});
		else splices.push({
			from: holder.end,
			to: holder.end,
			text: `\n<script type="application/json" id="${RECEIPT_ELEMENT_ID}">${scriptJson(counts)}<\/script>`
		});
	}
	const title = escapeHtmlText(`${roadmap.title}${TITLE_SUFFIX}`);
	const titleElement = elements.find((e) => e.name === "title");
	if (titleElement) splices.push({
		from: titleElement.contentStart,
		to: titleElement.contentEnd,
		text: title
	});
	else {
		const head = /<head\b[^>]*>/i.exec(template);
		const at = head ? head.index + head[0].length : holder.start;
		splices.push({
			from: at,
			to: at,
			text: `<title>${title}</title>`
		});
	}
	return applySplices(template, splices);
}
// src/roadmap/themes.ts
var THEMES;
var init_themes = __esmMin((() => {
	THEMES = [
		{
			id: "classic-topo",
			name: "Classic topo",
			surfaces: [
				"grass",
				"forest",
				"rock",
				"snow"
			],
			signpost: "timber",
			lampKelvin: 2900
		},
		{
			id: "alpine-winter",
			name: "Alpine winter",
			surfaces: [
				"forest",
				"scree",
				"rock",
				"snow"
			],
			signpost: "snow-pole",
			lampKelvin: 4200
		},
		{
			id: "desert-expedition",
			name: "Desert expedition",
			surfaces: [
				"sand",
				"dirt",
				"rock"
			],
			signpost: "cairn",
			lampKelvin: 2500
		},
		{
			id: "coastal-survey",
			name: "Coastal survey",
			surfaces: [
				"water",
				"sand",
				"grass",
				"rock"
			],
			signpost: "buoy",
			lampKelvin: 3600
		}
	];
}));
// src/look/theme.ts
/** Reads `#rgb` or `#rrggbb`. */
function hexToRgb(hex) {
	const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!match?.[1]) throw new Error(`hexToRgb: "${hex}" is not a hex colour`);
	const digits = match[1].length === 3 ? match[1].replace(/./g, "$&$&") : match[1];
	const value = Number.parseInt(digits, 16);
	return [
		(value >> 16 & 255) / 255,
		(value >> 8 & 255) / 255,
		(value & 255) / 255
	];
}
/** A hex colour with an alpha, as a CSS colour: `withAlpha('#1f2a3d', 0.5)` is `rgba(31, 42, 61, 0.5)`. */
function withAlpha(hex, alpha) {
	const [r, g, b] = hexToRgb(hex);
	return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}
var THEME, FOCUS;
var init_theme = __esmMin((() => {
	init_palette();
	THEME = {
		...PALETTE,
		/** The page before the lamp is on. */
		void: "#05070b",
		/** The cloth under the table. */
		cloth: "#18202e",
		clothDeep: "#0d121b",
		/** The turntable. */
		walnut: "#5a4532",
		walnutDeep: "#1c140e",
		/** Type on the room. */
		text: "#eef0f2",
		textSoft: "#a9b2bf",
		textFaint: "#8a94a3",
		/** The second paper tone of the contour cards. */
		card: "#ece5d8",
		/** The lamp once it is warm, the lamp before it warms, and the low sun of the dive. */
		lampLight: "#ffe9c9",
		lampCold: "#b9c9ff",
		sun: "#ffe7c2",
		/** Cover cloth by target tier. `paperHi` is the type colour on all four. */
		cover: {
			bronze: "#7d5233",
			silver: "#566170",
			gold: "#86671d",
			diamond: "#48579a"
		},
		/** The two marked states of a resource. */
		status: {
			gated: "#8a5a12",
			unverified: PALETTE.inkSoft
		},
		/** Tape on notes. */
		tape: "rgba(226, 208, 160, 0.55)"
	};
	FOCUS = {
		width: 2,
		offset: 2,
		room: THEME.lamp,
		paper: THEME.ink,
		/** The halo as a box shadow: a band of lamp colour under the ink ring and a soft glow beyond it. */
		halo: "0 0 0 4px var(--zt-lamp), 0 0 10px 6px rgba(255, 217, 160, 0.6)"
	};
	THEME.text, THEME.night, THEME.textSoft, THEME.night, THEME.textFaint, THEME.night, THEME.text, THEME.nightSoft, THEME.textSoft, THEME.nightSoft, THEME.textFaint, THEME.nightSoft, THEME.ink, THEME.paper, THEME.ink, THEME.paperHi, THEME.ink, THEME.card, THEME.inkSoft, THEME.paper, THEME.inkSoft, THEME.paperHi, THEME.signalDeep, THEME.paper, THEME.signalDeep, THEME.paperHi, THEME.status.gated, THEME.paper, THEME.status.gated, THEME.paperHi, THEME.status.unverified, THEME.paper, THEME.paperHi, THEME.cover.bronze, THEME.paperHi, THEME.cover.silver, THEME.paperHi, THEME.cover.gold, THEME.paperHi, THEME.cover.diamond;
	FOCUS.room, THEME.night, FOCUS.room, THEME.nightSoft, FOCUS.paper, THEME.paper, FOCUS.paper, THEME.paperHi, FOCUS.paper, THEME.card, FOCUS.paper, THEME.lamp;
}));
// src/props/brush.ts
function createBrush(ctx, width, height, cutting) {
	return {
		ctx,
		width,
		height,
		cutting,
		piece(color, path) {
			ctx.beginPath();
			path(ctx);
			if (cutting) {
				ctx.fillStyle = "#fff";
				ctx.fill();
				return;
			}
			ctx.fillStyle = color;
			ctx.fill();
			ctx.strokeStyle = color;
			ctx.lineWidth = BLEED;
			ctx.lineJoin = "round";
			ctx.stroke();
		},
		tone(color, alpha, path) {
			if (cutting) return;
			ctx.beginPath();
			path(ctx);
			ctx.fillStyle = alpha >= 1 ? color : withAlpha(color, alpha);
			ctx.fill();
		},
		line(color, alpha, lineWidth, path) {
			if (cutting) return;
			ctx.beginPath();
			path(ctx);
			ctx.strokeStyle = alpha >= 1 ? color : withAlpha(color, alpha);
			ctx.lineWidth = lineWidth;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			ctx.stroke();
		},
		inside(path, body) {
			ctx.save();
			ctx.beginPath();
			path(ctx);
			ctx.clip();
			body();
			ctx.restore();
		},
		upright(body) {
			if (cutting) return;
			ctx.save();
			ctx.translate(0, height);
			ctx.scale(1, -1);
			body(ctx);
			ctx.restore();
		}
	};
}
/** Runs a drawing on a canvas of `pxWidth` pixels for a drawing `width` units wide. */
function run$1(drawing, width, height, cutting) {
	return (ctx, pxWidth, pxHeight) => {
		const scale = pxWidth / width;
		ctx.save();
		ctx.translate(0, pxHeight);
		ctx.scale(scale, -scale);
		drawing(createBrush(ctx, width, height, cutting));
		ctx.restore();
	};
}
/** The two canvas drawings a sheet needs, from one brush drawing of `width` by `height` drawing units. */
function sheetDrawings(drawing, width, height) {
	return {
		outline: run$1(drawing, width, height, true),
		print: run$1(drawing, width, height, false)
	};
}
var BLEED;
var init_brush = __esmMin((() => {
	init_theme();
	BLEED = 1.6;
}));
// src/props/shapes.ts
/** A closed shape with straight edges. `round` softens the corners, as scissors do when they turn. */
function poly(points, round = 0) {
	return (ctx) => {
		const n = points.length;
		if (n < 3) return;
		if (round <= 0) {
			ctx.moveTo(points[0][0], points[0][1]);
			for (let i = 1; i < n; i += 1) ctx.lineTo(points[i][0], points[i][1]);
			ctx.closePath();
			return;
		}
		const start = mid(points[n - 1], points[0]);
		ctx.moveTo(start[0], start[1]);
		for (let i = 0; i < n; i += 1) {
			const before = points[(i + n - 1) % n];
			const here = points[i];
			const after = points[(i + 1) % n];
			const r = Math.min(round, dist(before, here) * .45, dist(here, after) * .45);
			ctx.arcTo(here[0], here[1], after[0], after[1], r);
		}
		ctx.closePath();
	};
}
/** A closed soft shape. The points pull the curve towards them, they do not lie on it. */
function curve(points) {
	return (ctx) => {
		const n = points.length;
		if (n < 3) return;
		const start = mid(points[n - 1], points[0]);
		ctx.moveTo(start[0], start[1]);
		for (let i = 0; i < n; i += 1) {
			const here = points[i];
			const next = mid(here, points[(i + 1) % n]);
			ctx.quadraticCurveTo(here[0], here[1], next[0], next[1]);
		}
		ctx.closePath();
	};
}
/** An open run of straight strokes, for printed lines. */
function strip(points) {
	return (ctx) => {
		points.forEach((point, index) => index === 0 ? ctx.moveTo(point[0], point[1]) : ctx.lineTo(point[0], point[1]));
	};
}
/** An open soft stroke through the first and last point, pulled towards the ones between. */
function sweep(points) {
	return (ctx) => {
		const n = points.length;
		if (n < 2) return;
		ctx.moveTo(points[0][0], points[0][1]);
		if (n === 2) {
			ctx.lineTo(points[1][0], points[1][1]);
			return;
		}
		for (let i = 1; i < n - 1; i += 1) {
			const here = points[i];
			const next = i === n - 2 ? points[n - 1] : mid(here, points[i + 1]);
			ctx.quadraticCurveTo(here[0], here[1], next[0], next[1]);
		}
	};
}
function disc(x, y, r) {
	return (ctx) => {
		ctx.moveTo(x + r, y);
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.closePath();
	};
}
function oval(x, y, rx, ry, turn = 0) {
	return (ctx) => {
		ctx.moveTo(x + rx * Math.cos(turn), y + rx * Math.sin(turn));
		ctx.ellipse(x, y, rx, ry, turn, 0, Math.PI * 2);
		ctx.closePath();
	};
}
/** A rectangle from its lower left corner, with round corners. */
function box(x, y, width, height, round = 0) {
	return poly([
		[x, y],
		[x + width, y],
		[x + width, y + height],
		[x, y + height]
	], round);
}
/** Points along a curve from `from` to `to` that bends towards `pull`. */
function arcPoints(from, pull, to, steps = 10) {
	const points = [];
	for (let i = 0; i <= steps; i += 1) {
		const t = i / steps;
		const a = (1 - t) * (1 - t);
		const b = 2 * (1 - t) * t;
		const c = t * t;
		points.push([a * from[0] + b * pull[0] + c * to[0], a * from[1] + b * pull[1] + c * to[1]]);
	}
	return points;
}
/**
* A band of paper that follows a line: a stem, a branch, a rail. Its width runs from `startWidth` at the first
* point to `endWidth` at the last, and both ends are cut square.
*/
function band(points, startWidth, endWidth = startWidth) {
	return (ctx) => {
		const n = points.length;
		if (n < 2) return;
		const left = [];
		const right = [];
		for (let i = 0; i < n; i += 1) {
			const before = points[Math.max(0, i - 1)];
			const after = points[Math.min(n - 1, i + 1)];
			const length = dist(before, after) || 1;
			const nx = -(after[1] - before[1]) / length;
			const ny = (after[0] - before[0]) / length;
			const half = (startWidth + (endWidth - startWidth) * i / (n - 1)) / 2;
			const here = points[i];
			left.push([here[0] + nx * half, here[1] + ny * half]);
			right.push([here[0] - nx * half, here[1] - ny * half]);
		}
		ctx.moveTo(left[0][0], left[0][1]);
		for (let i = 1; i < n; i += 1) ctx.lineTo(left[i][0], left[i][1]);
		for (let i = n - 1; i >= 0; i -= 1) ctx.lineTo(right[i][0], right[i][1]);
		ctx.closePath();
	};
}
/** A blade: wide at the root, a point at the tip, bent a little on the way. Grass, leaves, flames. */
function blade(root, width, tip, bend = 0) {
	return (ctx) => {
		const dx = tip[0] - root[0];
		const dy = tip[1] - root[1];
		const length = Math.hypot(dx, dy) || 1;
		const nx = -dy / length;
		const ny = dx / length;
		const mx = root[0] + dx * .55 + nx * bend;
		const my = root[1] + dy * .55 + ny * bend;
		const hx = nx * width / 2;
		const hy = ny * width / 2;
		ctx.moveTo(root[0] + hx, root[1] + hy);
		ctx.quadraticCurveTo(mx + hx, my + hy, tip[0], tip[1]);
		ctx.quadraticCurveTo(mx - hx, my - hy, root[0] - hx, root[1] - hy);
		ctx.closePath();
	};
}
/** Several paths as one. */
function all(...paths) {
	return (ctx) => {
		for (const path of paths) path(ctx);
	};
}
var mid, dist;
var init_shapes = __esmMin((() => {
	mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
	dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
}));
// src/i18n/index.ts
function isUiLang(value) {
	return typeof value === "string" && UI_LANGS.includes(value);
}
/** Reduces a language tag such as `de-AT` to an interface language, or null when it is neither. */
function matchUiLang(tag) {
	if (!tag) return null;
	const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
	return isUiLang(primary) ? primary : null;
}
/** The rule: `?ui=`, then the stored choice, then the browser's languages in order, then English. */
function resolveUiLang(sources) {
	if (sources.search) {
		const fromQuery = matchUiLang(new URLSearchParams(sources.search).get("ui"));
		if (fromQuery) return fromQuery;
	}
	const stored = matchUiLang(sources.stored);
	if (stored) return stored;
	for (const tag of sources.languages ?? []) {
		const match = matchUiLang(tag);
		if (match) return match;
	}
	return "en";
}
function readStored() {
	try {
		return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
	} catch {
		return null;
	}
}
/** The interface language of this page. Resolved once, then kept until `setUiLang` changes it. */
function uiLang() {
	if (chosen) return chosen;
	const nav = typeof navigator === "undefined" ? null : navigator;
	chosen = resolveUiLang({
		search: typeof location === "undefined" ? null : location.search,
		stored: readStored(),
		languages: nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : null
	});
	return chosen;
}
function pluralRule(lang, count) {
	try {
		return new Intl.PluralRules(lang).select(count);
	} catch {
		return count === 1 ? "one" : "other";
	}
}
function render(value, vars, lang) {
	let template;
	if (typeof value === "string") template = value;
	else {
		const count = Number(vars?.count);
		template = (count === 0 && value.zero !== void 0 ? value.zero : void 0) ?? (Number.isFinite(count) ? value[pluralRule(lang, count)] : void 0) ?? value.other;
	}
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (whole, name) => name in vars ? String(vars[name]) : whole);
}
/**
* Registers the words of one package under a namespace and returns a lookup typed to its keys.
*
* ```ts
* const say = defineStrings('shelf', {
*   en: { sources: { one: '{count} source', other: '{count} sources' } },
*   de: { sources: { one: '{count} Quelle', other: '{count} Quellen' } },
* });
* say('sources', { count: 5 });   // "5 sources"
* t('shelf.sources', { count: 1 }) // the same string by its full key
* ```
*
* The type makes a missing German key a compile error. `missingKeys` checks the same at run time for tables
* that were built dynamically, and every package asserts it in a test.
*/
function defineStrings(ns, table) {
	if (!/^[a-z][a-z0-9-]*$/.test(ns)) throw new Error(`defineStrings: "${ns}" is not a valid namespace`);
	registry.set(ns, table);
	return (key, vars, lang) => {
		const active = lang ?? uiLang();
		const value = table[active][key] ?? table.en[key];
		return value === void 0 ? `${ns}.${key}` : render(value, vars, active);
	};
}
var UI_LANGS, registry, STORAGE_KEY, chosen;
var init_i18n = __esmMin((() => {
	UI_LANGS = ["en", "de"];
	registry = /* @__PURE__ */ new Map();
	STORAGE_KEY = "zero-to:ui";
	chosen = null;
})), PROPS_STRINGS;
var init_strings = __esmMin((() => {
	init_i18n();
	PROPS_STRINGS = {
		en: {
			stageOf: "Stage {i} of {n}",
			handsOn: "{percent} % hands-on",
			tierUp: "Up to {tier}",
			passed: "Passed",
			tierBronze: "Bronze",
			tierSilver: "Silver",
			tierGold: "Gold",
			tierDiamond: "Diamond",
			signTimberName: "Timber fingerpost",
			signTimber: "A wooden post with pointed boards, the classic sign at a path junction. It suits any roadmap and is the default.",
			signCairnName: "Cairn",
			signCairn: "A pile of flat stones with a weathered stick through the top that carries the boards. For bare, stony or desert ground where nothing else would stand.",
			signTrigPillarName: "Survey pillar",
			signTrigPillar: "A squat concrete survey pillar with a brass plate and a steel rod that carries enamel plates. For exact subjects: mathematics, measurement, engineering.",
			signBlazePostName: "Waymark post",
			signBlazePost: "A grey squared post with a painted white and red waymark near the top. For woodland and for long routes with many small steps.",
			signSnowPoleName: "Snow pole",
			signSnowPole: "A tall black and white pole in a snow drift, the kind that marks a road under deep snow. For high, cold or wintry roadmaps.",
			signBuoyName: "Buoy",
			signBuoy: "A brass buoy on the water with a lattice mast, a lamp and signal pennants. For water, coasts and anything that is a voyage.",
			signSummitFlagName: "Summit flag",
			signSummitFlag: "A tall pole on a few stones with a long pennant at the top and smaller pennants below. For the last checkpoint, or for a short roadmap with one clear goal.",
			stationStages: "Stages",
			stationCheckpoints: "Checkpoints",
			stationProjects: "Projects",
			stationSources: "Checked sources",
			stationPace: "Pace"
		},
		de: {
			stageOf: "Etappe {i} von {n}",
			handsOn: "{percent} % Praxis",
			tierUp: "Aufstieg zu {tier}",
			passed: "Geschafft",
			tierBronze: "Bronze",
			tierSilver: "Silber",
			tierGold: "Gold",
			tierDiamond: "Diamant",
			signTimberName: "Holzwegweiser",
			signTimber: "Ein Holzpfosten mit spitzen Brettern, der klassische Wegweiser an einer Weggabelung. Er passt zu jeder Roadmap und ist die Voreinstellung.",
			signCairnName: "Steinmann",
			signCairn: "Ein Stapel flacher Steine mit einem verwitterten Stock, der die Bretter trägt. Für kahlen, steinigen oder wüstenhaften Boden, auf dem sonst nichts stehen würde.",
			signTrigPillarName: "Vermessungspfeiler",
			signTrigPillar: "Ein gedrungener Betonpfeiler der Landesvermessung mit Messingplatte und einer Stahlstange, die Emailschilder trägt. Für genaue Fächer: Mathematik, Messen, Technik.",
			signBlazePostName: "Markierungspfosten",
			signBlazePost: "Ein grauer Vierkantpfosten mit einer weiß-roten Wegmarkierung oben. Für Wald und für lange Routen mit vielen kleinen Schritten.",
			signSnowPoleName: "Schneestange",
			signSnowPole: "Eine hohe schwarz-weiße Stange in einer Schneewehe, wie sie eine Straße unter tiefem Schnee markiert. Für hohe, kalte oder winterliche Roadmaps.",
			signBuoyName: "Boje",
			signBuoy: "Eine Messingboje auf dem Wasser mit Gittermast, Lampe und Signalwimpeln. Für Wasser, Küsten und alles, was eine Überfahrt ist.",
			signSummitFlagName: "Gipfelfahne",
			signSummitFlag: "Eine hohe Stange auf ein paar Steinen mit einem langen Wimpel an der Spitze und kleineren darunter. Für den letzten Checkpoint oder für eine kurze Roadmap mit einem klaren Ziel.",
			stationStages: "Etappen",
			stationCheckpoints: "Checkpoints",
			stationProjects: "Projekte",
			stationSources: "Geprüfte Quellen",
			stationPace: "Tempo"
		}
	};
	defineStrings("props", PROPS_STRINGS);
}));
// src/props/signposts.ts
function defineStyle(input) {
	const { outline, print } = sheetDrawings(input.draw, input.width, input.height);
	const [zoneTop, zoneBottom] = input.zone;
	return {
		key: input.key,
		size: {
			width: input.width / 100,
			height: input.height / 100
		},
		draw: input.draw,
		outline,
		print,
		arm: {
			shape: input.arm.shape,
			board: input.arm.board,
			edge: input.arm.edge,
			ink: input.arm.ink ?? T.ink,
			height: input.arm.height / 100,
			reach: input.arm.reach / 100
		},
		arms(n) {
			const count = Math.min(5, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));
			const widest = input.arm.height + ARM_GAP;
			const pitch = count === 1 ? widest : Math.min(widest, (zoneTop - zoneBottom) / (count - 1));
			const height = Math.min(input.arm.height, pitch - ARM_GAP);
			const anchors = [];
			for (let i = 0; i < count; i += 1) anchors.push({
				x: (input.mast - input.width / 2) / 100,
				y: (zoneTop - i * pitch) / 100,
				height: height / 100,
				reach: input.arm.reach / 100
			});
			return anchors;
		},
		paper: input.paper,
		soft: input.soft ?? .007,
		sway: input.sway ?? .004,
		deckle: Math.min(.0042, Math.max(8e-4, .03 * input.thin / input.height)),
		top: {
			x: (input.top[0] - input.width / 2) / 100,
			y: input.top[1] / 100
		}
	};
}
/** A few stones and a tuft at the foot, so a post stands in the ground and not on it. */
function footStones(b, x, spread) {
	const left = poly([
		[x - spread, -4],
		[x - spread + 1, 5],
		[x - spread * .42, 7.5],
		[x - 2, 3],
		[x - 2, -4]
	], 1);
	const right = poly([
		[x + 2, -4],
		[x + 2.5, 4],
		[x + spread * .55, 6.5],
		[x + spread, 2.5],
		[x + spread, -4]
	], 1);
	b.piece(S.rock, left);
	b.piece(S.scree, right);
	b.inside(left, () => b.tone(T.ink, .2, box(x - spread - 1, -6, spread * .42, 16)));
	b.inside(right, () => b.tone(T.paperHi, .26, poly([
		[x + spread * .55, 6.5],
		[x + spread, 2.5],
		[x + spread * .6, 1]
	])));
}
/** A pile of flat stones, each with a shaded side and a pale top edge. */
function cairnStones(b, stones, dx = 0, scale = 1) {
	for (const [color, raw] of stones) {
		const points = raw.map(([x, y]) => [dx + x * scale, y < 0 ? y : y * scale]);
		const stone = poly(points, 2.8 * scale);
		b.piece(S[color], stone);
		b.inside(stone, () => {
			const xs = points.map((point) => point[0]);
			const ys = points.map((point) => point[1]);
			const left = Math.min(...xs);
			const right = Math.max(...xs);
			const top = Math.max(...ys);
			const bottom = Math.max(-8, Math.min(...ys));
			const wide = right - left;
			b.tone(T.ink, .2, poly([
				[left - 2, bottom - 2],
				[left - 2, top + 2],
				[left + wide * .18, top + 2],
				[left + wide * .34, bottom - 2]
			]));
			b.tone(T.paperHi, .28, poly([
				[left + wide * .52, top + 2],
				[right + 2, top + 2],
				[right + 2, top - 5 * scale],
				[left + wide * .62, top - 2.6 * scale]
			]));
		});
	}
}
var T, S, SIGNPOST_KEYS, DEFAULT_SIGNPOST, ARM_GAP, timber, CAIRN_STONES, cairn, trigPillar, blazePost, snowPole, buoy, SUMMIT_STONES, summitFlag, CATALOGUE_KEYS, SIGNPOST_CATALOGUE;
var init_signposts = __esmMin((() => {
	init_theme();
	init_brush();
	init_shapes();
	init_strings();
	T = THEME;
	S = THEME.surface;
	SIGNPOST_KEYS = [
		"timber",
		"cairn",
		"trig-pillar",
		"blaze-post",
		"snow-pole",
		"buoy",
		"summit-flag"
	];
	DEFAULT_SIGNPOST = "timber";
	ARM_GAP = 2.4;
	timber = defineStyle({
		key: "timber",
		width: 30,
		height: 106,
		mast: 15,
		zone: [84, 14],
		arm: {
			shape: "finger",
			board: S.sand,
			edge: S.dirt,
			height: 15,
			reach: 78
		},
		paper: S.dirt,
		thin: 9,
		top: [15, 100],
		draw(b) {
			footStones(b, 15, 13);
			const post = poly([
				[10.2, -4],
				[10.8, 94],
				[15, 101.5],
				[19.2, 94],
				[19.8, -4]
			], .9);
			b.piece(S.dirt, post);
			b.inside(post, () => {
				b.tone(T.walnut, .5, box(8, -6, 5.2, 112));
				b.tone(T.paperHi, .18, box(17.2, -6, 3, 112));
				b.line(T.walnutDeep, .3, .45, all(strip([[14.2, 2], [14.6, 34]]), strip([[16.6, 46], [16.4, 88]]), strip([[14, 56], [14.3, 80]]), oval(15.6, 40, 1.2, 2.1)));
				b.line(T.walnutDeep, .4, .6, strip([[10, 91], [20, 91]]));
			});
			b.piece(S.grass, blade([8, -4], 4, [5, 9], .8));
			b.piece(S.grass, blade([22.5, -4], 4, [26, 8], -.8));
		}
	});
	CAIRN_STONES = [
		["rock", [
			[.5, -4],
			[1.5, 7],
			[8, 12.5],
			[24, 11.5],
			[30.5, 6],
			[31, -4]
		]],
		["scree", [
			[28, -4],
			[29, 9.5],
			[37, 12.8],
			[52, 11],
			[59, 5],
			[58.5, -4]
		]],
		["scree", [
			[6, 11],
			[8, 19],
			[17, 22.6],
			[34, 22],
			[47, 18.5],
			[49.5, 12.4],
			[40, 10.4]
		]],
		["rock", [
			[13.5, 21],
			[14.5, 28.5],
			[24, 32],
			[39, 30.5],
			[44.5, 25],
			[43, 21]
		]],
		["scree", [
			[18.5, 30],
			[20, 37],
			[29, 39.6],
			[38.5, 36],
			[39, 30.6]
		]],
		["rock", [
			[23.5, 37.6],
			[25, 43],
			[31, 44.6],
			[36, 41.5],
			[35, 38]
		]]
	];
	cairn = defineStyle({
		key: "cairn",
		width: 60,
		height: 126,
		mast: 30,
		zone: [112, 58],
		arm: {
			shape: "finger",
			board: S.sand,
			edge: S.dirt,
			height: 13,
			reach: 70
		},
		paper: S.rock,
		thin: 3,
		soft: .005,
		top: [30.5, 122],
		draw(b) {
			const stick = band(arcPoints([28.5, 30], [31.5, 80], [30.5, 124], 10), 3.8, 2.6);
			b.piece(T.walnut, stick);
			b.inside(stick, () => b.tone(T.walnutDeep, .45, band(arcPoints([27.4, 30], [30.4, 80], [29.6, 124], 10), 1.6, 1.1)));
			b.piece(T.walnut, band([[30.6, 96], [35.5, 102]], 1.9, 1.3));
			cairnStones(b, CAIRN_STONES);
		}
	});
	trigPillar = defineStyle({
		key: "trig-pillar",
		width: 46,
		height: 124,
		mast: 23,
		zone: [108, 58],
		arm: {
			shape: "plate",
			board: T.paperHi,
			edge: T.steel,
			height: 12.5,
			reach: 70
		},
		paper: T.paperShade,
		thin: 2.8,
		soft: .005,
		top: [23, 120],
		draw(b) {
			const rod = band([[23, 40], [23, 118]], 2.8);
			b.piece(T.steel, rod);
			b.inside(rod, () => b.tone(T.ink, .22, box(21.6, 38, 1.1, 84)));
			b.piece(T.brass, disc(23, 120, 3.2));
			b.tone(T.paperHi, .4, disc(24, 121, 1.1));
			const pillar = poly([
				[5, -4],
				[10.5, 43],
				[35.5, 43],
				[41, -4]
			], 1.2);
			b.piece(T.paperShade, pillar);
			b.inside(pillar, () => {
				b.tone(T.ink, .15, poly([
					[2, -6],
					[10.5, 43],
					[17.5, 43],
					[14, -6]
				]));
				b.tone(T.paperHi, .34, poly([
					[30.5, 43],
					[35.5, 43],
					[41, -6],
					[35, -6]
				]));
				b.line(T.inkSoft, .3, .45, all(strip([[7.5, 14], [38.5, 14]]), strip([[9.4, 30], [36.6, 30]])));
				b.tone(T.brass, 1, box(18.6, 18.5, 8.8, 9, .8));
				b.tone(T.brassDeep, 1, all(disc(20.4, 25.6, .6), disc(25.6, 25.6, .6), disc(20.4, 20.4, .6), disc(25.6, 20.4, .6)));
				b.line(T.inkSoft, .7, .7, all(strip([[23, 3.4], [23, 11]]), strip([
					[19.6, 7],
					[23, 11],
					[26.4, 7]
				]), strip([[19, 11.6], [27, 11.6]])));
			});
			const cap = box(8.6, 42, 28.8, 4, 1);
			b.piece(T.steel, cap);
			b.inside(cap, () => b.tone(T.ink, .2, box(8, 42, 30, 1.5)));
		}
	});
	blazePost = defineStyle({
		key: "blaze-post",
		width: 32,
		height: 118,
		mast: 16,
		zone: [82, 18],
		arm: {
			shape: "finger",
			board: T.card,
			edge: S.scree,
			height: 14,
			reach: 76
		},
		paper: S.scree,
		thin: 9,
		top: [16, 113],
		draw(b) {
			const post = poly([
				[10, -4],
				[10, 109],
				[12.5, 114],
				[22, 111.5],
				[22, -4]
			], .9);
			b.piece(S.scree, post);
			b.inside(post, () => {
				b.tone(T.ink, .2, box(8, -6, 5.4, 124));
				b.tone(T.paperHi, .2, box(19.4, -6, 3.4, 124));
				b.line(T.ink, .22, .45, all(strip([[15, 4], [15.4, 40]]), strip([[18, 30], [17.6, 80]]), strip([[14.4, 52], [14.8, 86]])));
				b.tone(T.paperHi, 1, box(10, 90.5, 12, 15.5));
				b.tone(T.signal, 1, box(10, 95.6, 12, 5.2));
				b.tone(T.ink, .12, box(8, 90.5, 5.4, 15.5));
			});
			b.piece(S.grass, blade([8.5, -4], 4.4, [4, 11], 1));
			b.piece(S.forest, blade([10.5, -4], 4, [8.5, 14], .3));
			b.piece(S.grass, blade([23, -4], 4.4, [28.5, 10], -1));
			b.piece(S.forest, blade([21.5, -4], 4, [24, 13], -.3));
		}
	});
	snowPole = defineStyle({
		key: "snow-pole",
		width: 48,
		height: 136,
		mast: 24,
		zone: [110, 36],
		arm: {
			shape: "plate",
			board: T.paperHi,
			edge: T.inkSoft,
			height: 13.5,
			reach: 72
		},
		paper: T.paperHi,
		thin: 5,
		soft: .006,
		top: [24, 132],
		draw(b) {
			const pole = box(21.4, -4, 5.2, 137, 2.4);
			b.piece(T.paperHi, pole);
			b.inside(pole, () => {
				for (let y = 6; y < 110; y += 34) b.tone(T.ink, 1, box(20, y, 8, 17));
				b.tone(T.signal, 1, box(20, 118, 8, 20));
				b.tone(T.ink, .22, box(20, -6, 2.2, 144));
				b.tone(T.paperHi, .3, box(25, -6, 1, 144));
			});
			const mound = curve([
				[-6, -6],
				[-2, 6],
				[10, 12.5],
				[25, 14],
				[38, 11],
				[50, 5],
				[54, -6]
			]);
			b.piece(S.snow, mound);
			b.inside(mound, () => {
				b.tone(S.water, .3, curve([
					[-8, -8],
					[-4, 6],
					[8, 12],
					[15, 4],
					[18, -8]
				]));
				b.line(S.water, .5, .5, sweep([
					[26, 5],
					[34, 4],
					[43, 1]
				]));
			});
		}
	});
	buoy = defineStyle({
		key: "buoy",
		width: 62,
		height: 134,
		mast: 31,
		zone: [98, 48],
		arm: {
			shape: "pennant",
			board: T.paperHi,
			edge: T.brass,
			height: 13,
			reach: 68
		},
		paper: T.brass,
		thin: 2,
		soft: .0045,
		sway: .008,
		top: [31, 131],
		draw(b) {
			const legs = all(band([[23, 36], [29.4, 104]], 2.4, 2), band([[39, 36], [32.6, 104]], 2.4, 2));
			b.piece(T.steel, legs);
			b.piece(T.steel, all(band([[24.4, 50], [36.4, 64]], 1.5), band([[37.6, 50], [25.6, 64]], 1.5), band([[26.6, 72], [34.6, 84]], 1.4), band([[35.4, 72], [27.4, 84]], 1.4)));
			b.piece(T.steel, box(26, 103, 10, 3, 1));
			b.piece(T.lamp, disc(31, 110.5, 5));
			b.tone(T.paperHi, .6, disc(32.4, 112, 1.8));
			b.line(T.steel, 1, .8, all(strip([[31, 105.5], [31, 115.5]]), strip([[26.2, 110.5], [35.8, 110.5]])));
			b.piece(T.ink, all(poly([
				[31, 133],
				[26, 125],
				[36, 125]
			], .5), poly([
				[31, 124],
				[26, 116.5],
				[36, 116.5]
			], .5)));
			const float = poly([
				[13.5, 2],
				[10, 22],
				[15.5, 38],
				[46.5, 38],
				[52, 22],
				[48.5, 2]
			], 3);
			b.piece(T.brass, float);
			b.inside(float, () => {
				b.tone(T.ink, 1, box(6, 17, 50, 8));
				b.tone(T.brassDeep, .6, poly([
					[8, 0],
					[10, 22],
					[15.5, 40],
					[22, 40],
					[18, 22],
					[19, 0]
				]));
				b.tone(T.paperHi, .34, poly([
					[41, 40],
					[46.5, 40],
					[52, 22],
					[48.5, 0],
					[44, 0],
					[46.5, 22]
				]));
				b.line(T.brassDeep, .8, .6, all(strip([[12, 30.5], [50, 30.5]]), strip([[11, 11], [51, 11]])));
			});
			const sea = (ctx) => {
				ctx.moveTo(-6, -6);
				ctx.lineTo(-6, 4);
				for (let i = 0; i < 6; i += 1) {
					const x = -6 + i * 12.4;
					ctx.quadraticCurveTo(x + 3.1, 9, x + 6.2, 5);
					ctx.quadraticCurveTo(x + 9.3, 1.4, x + 12.4, 4);
				}
				ctx.lineTo(68.4, -6);
				ctx.closePath();
			};
			b.piece(S.water, sea);
			b.inside(sea, () => {
				b.tone(T.ink, .12, box(-8, -8, 80, 7));
				b.line(T.paperHi, .7, .6, all(sweep([
					[4, 1],
					[8, 3],
					[12, 1]
				]), sweep([
					[40, .5],
					[44, 2.5],
					[48, .5]
				]), sweep([
					[22, -1.5],
					[26, .5],
					[30, -1.5]
				])));
			});
		}
	});
	SUMMIT_STONES = [
		["rock", [
			[3, -4],
			[3.5, 8],
			[11, 13],
			[24, 12],
			[27, -4]
		]],
		["scree", [
			[24, -4],
			[25, 11],
			[40, 12.5],
			[49, 6],
			[48.5, -4]
		]],
		["scree", [
			[12, 11.5],
			[14, 20],
			[27, 23],
			[37, 19],
			[36, 11.5]
		]]
	];
	summitFlag = defineStyle({
		key: "summit-flag",
		width: 66,
		height: 142,
		mast: 26,
		zone: [100, 42],
		arm: {
			shape: "pennant",
			board: T.card,
			edge: S.dirt,
			height: 14,
			reach: 70
		},
		paper: T.walnut,
		thin: 3.2,
		soft: .005,
		sway: .007,
		top: [26, 139],
		draw(b) {
			const pole = band([[26, -4], [26, 137]], 3.4, 3);
			b.piece(T.walnut, pole);
			b.inside(pole, () => b.tone(T.walnutDeep, .5, box(24, -6, 1.5, 146)));
			b.piece(T.brass, disc(26, 138.6, 2.6));
			const flag = (ctx) => {
				ctx.moveTo(27.4, 134.5);
				ctx.bezierCurveTo(38, 137, 46, 128, 64, 126.5);
				ctx.bezierCurveTo(50, 123, 40, 117, 27.4, 114.5);
				ctx.closePath();
			};
			b.piece(T.brass, flag);
			b.inside(flag, () => {
				b.tone(T.paperHi, .85, (ctx) => {
					ctx.moveTo(27, 127.6);
					ctx.bezierCurveTo(38, 129.6, 46, 126.6, 64, 126.9);
					ctx.lineTo(64, 125);
					ctx.bezierCurveTo(48, 123.4, 38, 123, 27, 121.6);
					ctx.closePath();
				});
				b.tone(T.brassDeep, .5, poly([
					[40, 140],
					[45, 140],
					[41, 112],
					[37, 112]
				]));
			});
			cairnStones(b, SUMMIT_STONES);
			const snow = curve([
				[10, 20.5],
				[14, 25],
				[26, 26.5],
				[37, 23],
				[38, 19.5],
				[26, 21.5]
			]);
			b.piece(S.snow, snow);
			b.inside(snow, () => b.tone(S.water, .28, curve([
				[10, 20],
				[14, 22.5],
				[22, 23],
				[20, 19]
			])));
		}
	});
	Object.freeze({
		timber,
		cairn,
		"trig-pillar": trigPillar,
		"blaze-post": blazePost,
		"snow-pole": snowPole,
		buoy,
		"summit-flag": summitFlag
	});
	Object.freeze({
		"classic-topo": "timber",
		"alpine-winter": "snow-pole",
		"desert-expedition": "cairn",
		"coastal-survey": "buoy"
	});
	CATALOGUE_KEYS = {
		timber: [
			"signTimberName",
			"signTimber",
			[
				"grass",
				"forest",
				"dirt"
			]
		],
		cairn: [
			"signCairnName",
			"signCairn",
			[
				"rock",
				"scree",
				"sand"
			]
		],
		"trig-pillar": [
			"signTrigPillarName",
			"signTrigPillar",
			["grass", "rock"]
		],
		"blaze-post": [
			"signBlazePostName",
			"signBlazePost",
			["forest", "grass"]
		],
		"snow-pole": [
			"signSnowPoleName",
			"signSnowPole",
			["snow", "scree"]
		],
		buoy: [
			"signBuoyName",
			"signBuoy",
			["water", "sand"]
		],
		"summit-flag": [
			"signSummitFlagName",
			"signSummitFlag",
			["snow", "rock"]
		]
	};
	SIGNPOST_CATALOGUE = Object.freeze(SIGNPOST_KEYS.map((key) => {
		const [name, text, surfaces] = CATALOGUE_KEYS[key];
		return Object.freeze({
			key,
			default: key === DEFAULT_SIGNPOST,
			name: {
				en: PROPS_STRINGS.en[name],
				de: PROPS_STRINGS.de[name]
			},
			description: {
				en: PROPS_STRINGS.en[text],
				de: PROPS_STRINGS.de[text]
			},
			surfaces
		});
	}));
}));
var init_noise = __esmMin((() => {
	.5 * (Math.sqrt(3) - 1);
	(3 - Math.sqrt(3)) / 6;
	Array.from({ length: 12 }, (_, index) => {
		const angle = index / 12 * Math.PI * 2 + .13;
		return [Math.cos(angle), Math.sin(angle)];
	});
}));
// src/terrain/heightfield.ts
var init_heightfield = __esmMin((() => {
	init_noise();
})), STEPS;
var init_trail = __esmMin((() => {
	STEPS = [
		[1, 0],
		[2, 1],
		[1, 1],
		[1, 2],
		[0, 1],
		[-1, 2],
		[-1, 1],
		[-2, 1],
		[-1, 0],
		[-2, -1],
		[-1, -1],
		[-1, -2],
		[0, -1],
		[1, -2],
		[1, -1],
		[2, -1]
	];
	STEPS.length;
}));
// src/terrain/catalogue.ts
var TERRAIN_TEMPLATES, TRAIL_TEMPLATES;
var init_catalogue$1 = __esmMin((() => {
	init_heightfield();
	init_trail();
	TERRAIN_TEMPLATES = [
		{
			id: "volcano",
			name: "Volcano",
			description: "One cone with a crater on top. The summit is the highest point of the rim."
		},
		{
			id: "ridge",
			name: "Ridge",
			description: "A long narrow spine with a main summit and two lower tops along the crest."
		},
		{
			id: "massif",
			name: "Massif",
			description: "A broad mountain with a main summit and a ring of lower peaks round it."
		},
		{
			id: "twin-peaks",
			name: "Twin peaks",
			description: "Two summits joined by a saddle. The trail ends on the higher one."
		},
		{
			id: "plateau",
			name: "Plateau",
			description: "A flat-topped table mountain with cliffs all round and a small knoll as its summit."
		},
		{
			id: "canyon",
			name: "Canyon",
			description: "A mountain on a raised bench, with a winding river canyon cut through its base."
		}
	];
	TRAIL_TEMPLATES = [
		{
			id: "switchback",
			name: "Switchback",
			description: "Zigzags straight up the steepest face in tight hairpins."
		},
		{
			id: "ridge-walk",
			name: "Ridge walk",
			description: "Gains the longest spur and follows its crest to the top."
		},
		{
			id: "spiral",
			name: "Spiral",
			description: "Winds round the whole mountain, so every side is seen on the way up."
		},
		{
			id: "valley-first",
			name: "Valley first",
			description: "Walks in along low ground for the first half, then climbs out of the valley."
		},
		{
			id: "traverse",
			name: "Traverse",
			description: "Crosses one broad face from side to side in two or three long legs."
		}
	];
}));
// src/cli/catalogue.ts
var catalogue_exports = /* @__PURE__ */ __exportAll({
	DEFAULT_SIGNPOST: () => DEFAULT_SIGNPOST,
	MAP_THEMES: () => MAP_THEMES,
	SIGNPOST_KEYS: () => SIGNPOST_KEYS,
	mapCatalogue: () => mapCatalogue
});
function nameOf(id) {
	const words = id.split("-").join(" ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}
function mapCatalogue() {
	return {
		terrain: {
			field: "map.terrain",
			default: "random",
			note: "The shape of the mountain. \"random\" lets the seed pick one of these.",
			options: TERRAIN_TEMPLATES.map(({ id, name, description }) => ({
				id,
				name,
				description
			}))
		},
		trail: {
			field: "map.trail",
			default: "random",
			note: "How the route winds up. \"random\" lets the seed pick one of these.",
			options: TRAIL_TEMPLATES.map(({ id, name, description }) => ({
				id,
				name,
				description
			}))
		},
		surfaces: {
			field: "map.surfaces",
			default: "auto",
			note: "A list of these ground types from the bottom of the mountain to the top, or \"auto\" to let the theme decide.",
			options: SURFACE_KINDS.map((id) => ({
				id,
				name: nameOf(id)
			}))
		},
		signposts: {
			field: "map.signpost, stages[].checkpoint.signpost",
			default: DEFAULT_SIGNPOST,
			note: "The signpost at the end of each stage. Order of choice: the checkpoint, the map, the theme, then the default.",
			options: SIGNPOST_CATALOGUE.map((entry) => ({
				id: entry.key,
				name: entry.name.en,
				description: entry.description.en,
				surfaces: [...entry.surfaces]
			}))
		},
		themes: {
			field: "map.theme",
			default: null,
			note: "A theme sets the surface order for \"auto\", a default signpost and the lamp colour.",
			options: THEMES.map((theme) => ({
				id: theme.id,
				name: theme.name,
				description: `Ground ${theme.surfaces.join(", ")}. Signposts ${theme.signpost}. Lamp ${theme.lampKelvin} K.`
			}))
		}
	};
}
var MAP_THEMES;
var init_catalogue = __esmMin((() => {
	init_themes();
	init_signposts();
	init_palette();
	init_catalogue$1();
	MAP_THEMES = THEMES.map((theme) => theme.id);
}));
// src/cli/run.ts
/**
* The zero-to command-line tool: validate, check-links, build, link, student and catalogue.
* `run` takes the arguments and an Io object and resolves to the exit code; it never calls process.exit.
*/
var VERSION = "0.1.0";
var DEFAULT_SHARE_BASE = "https://othmanadi.github.io/zero-to/";
var RECEIPT_FORMAT = "zero-to/links-1";
var HELP = `zero-to ${VERSION}: check, build and share zero-to roadmap files.

Usage: node zero-to.mjs <command> <roadmap.json> [options]

Commands
  validate <roadmap.json>
      Check the file against the schema and the roadmap rules. Prints every
      error and warning with its JSON pointer.

  check-links <roadmap.json> [--write] [--receipt <file>] [--trust-200]
      Open every resource address (at most 4 at once, 15 s each, up to 5
      redirects; YouTube videos through the oEmbed lookup) and print a table
      with the totals "N opened, N kept, N dead, N flagged".
      --write          Write each result into the resource's "check" and set
                       "checkedOn" to today. Nothing is deleted.
      --receipt <file> Save every result as a JSON receipt.
      --trust-200      Mark a link that answers 200 as verified. Use it only
                       after reading the pages: a 200 proves the address is
                       reachable, not that the page is the right resource.

  build <roadmap.json> [--viewer <path>] [--out <file.html>] [--receipt <file>]
      Validate, then write one self-contained HTML file that opens offline.
      --viewer         Viewer template. Default: ../viewer/zero-to.html next
                       to this script.
      --out            Output file. Default: <roadmap id>.html next to the
                       roadmap.
      --receipt        A check-links receipt whose counts the page shows.

  link <roadmap.json> [--base <url>]
      Print a share link that carries the whole roadmap after "#r=".
      Default base: ${DEFAULT_SHARE_BASE}

  student <roadmap.json> [--out <file>]
      Write the student copy: no teacher notes, no session plans, no answers
      to assessed checks. Default: <name>.student.json next to the roadmap.

  catalogue
      Print the map options as JSON: terrain and trail templates, surfaces,
      signpost keys and themes.

  --help, --version

Exit codes: 0 done, 1 the roadmap has problems (or check-links found dead
links), 2 the command could not run (wrong usage, a missing file).`;
function parse(args, strings, booleans) {
	const options = { help: { type: "boolean" } };
	for (const name of strings) options[name] = { type: "string" };
	for (const name of booleans) options[name] = { type: "boolean" };
	try {
		const { values, positionals } = parseArgs({
			args: [...args],
			options,
			allowPositionals: true,
			strict: true
		});
		return {
			positionals,
			flags: values
		};
	} catch (cause) {
		throw new CliError(`${cause instanceof Error ? cause.message : String(cause)}\nRun "zero-to --help" for the commands and their options.`, 2);
	}
}
function onePath(parsed, command) {
	const [path, ...extra] = parsed.positionals;
	if (path === void 0) throw new CliError(`"${command}" needs a roadmap file, for example: zero-to ${command} my-roadmap.json`, 2);
	if (extra.length > 0) throw new CliError(`"${command}" takes one roadmap file, but got ${parsed.positionals.length}: ${parsed.positionals.join(", ")}`, 2);
	return path;
}
function stringFlag(parsed, name) {
	const value = parsed.flags[name];
	return typeof value === "string" ? value : void 0;
}
function writeText(path, text) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, "utf8");
}
function kb(bytes) {
	return `${(bytes / 1024).toFixed(1)} KB`;
}
function validateCommand(args, io) {
	const loaded = loadRoadmap(resolvePath(io, onePath(parse(args, [], []), "validate")));
	const report = formatValidation(loaded.path, loaded.result);
	if (loaded.result.ok) {
		io.out(report);
		return 0;
	}
	io.err(report);
	return 1;
}
function resourcesOf(data, path) {
	const list = data?.resources;
	if (!Array.isArray(list)) throw new CliError(`${basename(path)} has no "resources" list, so there are no links to check.`, 1);
	list.forEach((item, i) => {
		const r = item;
		if (r === null || typeof r !== "object" || typeof r.id !== "string" || typeof r.url !== "string") throw new CliError(`Resource ${i + 1} in ${basename(path)} needs a text "id" and a text "url" before its link can be checked.`, 1);
	});
	return list;
}
function pad(text, width) {
	return text.length >= width ? text : text + " ".repeat(width - text.length);
}
function cut(text, width) {
	return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}
function linkTable(results, before, trust200) {
	const idWidth = Math.min(28, Math.max(8, ...results.map((r) => r.resourceId.length)));
	const rows = results.map((r, i) => {
		const detail = r.outcome === "kept" ? keptDetail(r, before.get(r.resourceId), trust200) : r.reason;
		return [
			String(i + 1).padStart(3),
			pad(cut(r.resourceId, idWidth), idWidth),
			pad(r.outcome, 10),
			pad(r.http === null ? "-" : String(r.http), 4),
			cut(detail, 90)
		].join("  ");
	});
	return [[
		"  #",
		pad("resource", idWidth),
		pad("result", 10),
		"http",
		"detail"
	].join("  "), ...rows].join("\n");
}
async function checkLinksCommand(args, io) {
	const parsed = parse(args, ["receipt"], ["write", "trust-200"]);
	const path = resolvePath(io, onePath(parsed, "check-links"));
	const data = readJsonFile(path, "roadmap file");
	const resources = resourcesOf(data, path);
	const trust200 = parsed.flags["trust-200"] === true;
	const before = validateRoadmap(data);
	if (!before.ok) io.err(`Note: ${basename(path)} does not validate yet (${before.errors.length} errors). Checking the links anyway.`);
	const started = io.now();
	const today = localDay(started);
	io.err(`Opening ${resources.length} links, at most 4 at once. This can take a minute.`);
	const results = await checkResources(resources, { fetch: io.fetch });
	const finished = io.now();
	const statusBefore = new Map(resources.map((r) => [r.id, r.check?.status]));
	const totals = totalsOf(results);
	const nextChecks = /* @__PURE__ */ new Map();
	resources.forEach((r, i) => {
		const result = results[i];
		if (result) nextChecks.set(r.id, nextCheck(r.check, result, today, trust200));
	});
	io.out(linkTable(results, statusBefore, trust200));
	io.out("");
	io.out(formatTotals(totals));
	const unread = results.filter((r) => r.outcome === "kept" && statusBefore.get(r.resourceId) !== "verified" && !trust200).length;
	if (unread > 0) io.out(`${unread} reachable but not marked verified: read each page, then set its status to "verified" (or run again with --trust-200 once read).`);
	const receiptPath = stringFlag(parsed, "receipt");
	if (receiptPath !== void 0) {
		const id = data.id;
		const receipt = {
			receipt: RECEIPT_FORMAT,
			tool: `zero-to ${VERSION}`,
			roadmap: typeof id === "string" ? id : null,
			file: basename(path),
			checkedOn: today,
			startedAt: started.toISOString(),
			finishedAt: finished.toISOString(),
			trust200,
			totals,
			results: results.map((r) => ({
				...r,
				statusBefore: statusBefore.get(r.resourceId) ?? null,
				statusAfter: nextChecks.get(r.resourceId)?.status ?? null,
				decision: r.outcome === "kept" ? "kept" : r.outcome === "dead" ? "dropped" : "flagged"
			}))
		};
		const out = resolvePath(io, receiptPath);
		writeText(out, toJsonText(receipt));
		io.err(`Receipt written to ${out}.`);
	}
	if (parsed.flags.write === true) {
		const roadmap = data;
		roadmap.resources = resources.map((r) => {
			const check = nextChecks.get(r.id);
			return check === void 0 ? r : {
				...r,
				check
			};
		});
		roadmap.checkedOn = today;
		writeFileSync(path, toJsonText(roadmap), "utf8");
		io.err(`Updated the checks in ${path} and set checkedOn to ${today}. No resource was removed.`);
		const after = validateRoadmap(roadmap);
		if (!after.ok) io.err(`\nAfter this check the roadmap no longer validates. Replace dead links, read reachable ones, or add "gap" lines:\n${formatValidation(path, after)}`);
	}
	return totals.dead > 0 ? 1 : 0;
}
function readReceiptCounts(path) {
	const data = readJsonFile(path, "receipt");
	const totals = data?.totals;
	if (!totals || [
		"opened",
		"kept",
		"dead",
		"flagged"
	].some((k) => typeof totals[k] !== "number") || typeof data?.checkedOn !== "string") throw new CliError(`${path} is not a check-links receipt: it needs "totals" with opened, kept, dead and flagged, and "checkedOn".`, 1);
	return {
		opened: totals.opened,
		kept: totals.kept,
		dead: totals.dead,
		flagged: totals.flagged,
		checkedOn: data.checkedOn
	};
}
function defaultViewer(io) {
	return resolve(io.scriptDir, "..", "viewer", "zero-to.html");
}
function buildCommand(args, io) {
	const parsed = parse(args, [
		"viewer",
		"out",
		"receipt"
	], []);
	const path = resolvePath(io, onePath(parsed, "build"));
	const { roadmap, warnings } = requireValid(loadRoadmap(path), "built");
	const viewerFlag = stringFlag(parsed, "viewer");
	const viewer = viewerFlag === void 0 ? defaultViewer(io) : resolvePath(io, viewerFlag);
	if (!existsSync(viewer)) {
		io.err([`The viewer template is missing: ${viewer}`, viewerFlag === void 0 ? "The skill ships it as viewer/zero-to.html, next to the scripts folder. Reinstall the skill, or pass --viewer <path> to a zero-to viewer build." : "Check the path given to --viewer."].join("\n"));
		return 2;
	}
	const receiptFlag = stringFlag(parsed, "receipt");
	const receipt = receiptFlag === void 0 ? void 0 : readReceiptCounts(resolvePath(io, receiptFlag));
	let html;
	try {
		html = injectRoadmap(readFileSync(viewer, "utf8"), roadmap, receipt);
	} catch (cause) {
		if (cause instanceof ViewerTemplateError) {
			io.err(`${cause.message}\nTemplate: ${viewer}`);
			return 2;
		}
		throw cause;
	}
	const outFlag = stringFlag(parsed, "out");
	const out = outFlag === void 0 ? join(dirname(path), `${roadmap.id}.html`) : resolvePath(io, outFlag);
	writeText(out, html);
	const advice = warnings.length > 0 ? ` The roadmap has ${warnings.length} warning${warnings.length === 1 ? "" : "s"}; "validate" lists them.` : "";
	io.out(`Wrote ${out} (${kb(Buffer.byteLength(html, "utf8"))}). It opens offline in any browser.${advice}`);
	return 0;
}
async function linkCommand(args, io) {
	const parsed = parse(args, ["base"], []);
	const { roadmap } = requireValid(loadRoadmap(resolvePath(io, onePath(parsed, "link"))), "shared");
	const baseText = stringFlag(parsed, "base") ?? "https://othmanadi.github.io/zero-to/";
	let base;
	try {
		base = new URL(baseText);
	} catch {
		throw new CliError(`--base must be a full web address such as ${DEFAULT_SHARE_BASE}, not "${baseText}".`, 2);
	}
	if (base.protocol !== "https:" && base.protocol !== "http:") throw new CliError(`--base must start with https:// or http://, not "${baseText}".`, 2);
	base.hash = "";
	let fragment;
	try {
		fragment = await encodeRoadmap(roadmap);
	} catch (cause) {
		if (cause instanceof ShareTooLargeError) {
			io.err(cause.message);
			return 1;
		}
		throw cause;
	}
	if (hasTeacherParts(roadmap)) io.err("This roadmap holds teacher notes or session plans, and the link carries them. For students, share the student copy: zero-to student <roadmap.json>.");
	io.out(`${base.href}#r=${fragment}`);
	io.err(`The link is ${fragment.length.toLocaleString("en-US")} characters after "#r=" (the limit is ${MAX_FRAGMENT_LENGTH.toLocaleString("en-US")}).`);
	return 0;
}
function studentCommand(args, io) {
	const parsed = parse(args, ["out"], []);
	const path = resolvePath(io, onePath(parsed, "student"));
	const { roadmap } = requireValid(loadRoadmap(path), "written");
	const { roadmap: copy, removed } = studentCopy(roadmap);
	const check = validateRoadmap(copy);
	if (!check.ok) {
		io.err(`The student copy did not validate, so it was not written:\n${formatValidation(path, check)}`);
		return 1;
	}
	const outFlag = stringFlag(parsed, "out");
	const out = outFlag === void 0 ? join(dirname(path), `${basename(path, extname(path))}.student.json`) : resolvePath(io, outFlag);
	if (resolve(out) === resolve(path)) throw new CliError("The student copy would overwrite the teacher file. Pass a different --out.", 2);
	writeText(out, toJsonText(copy));
	const n = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
	io.out(`Wrote ${out}. Removed ${n(removed.teacherNotes, "teacher note")} and ${n(removed.sessions, "session plan")}, withheld ${n(removed.answers, "answer")} to assessed checks.`);
	return 0;
}
async function catalogueCommand(args, io) {
	if (parse(args, [], []).positionals.length > 0) throw new CliError("\"catalogue\" takes no file.", 2);
	const { mapCatalogue } = await Promise.resolve().then(() => (init_catalogue(), catalogue_exports));
	io.out(JSON.stringify(mapCatalogue(), null, 2));
	return 0;
}
var COMMANDS = {
	validate: validateCommand,
	"check-links": checkLinksCommand,
	build: buildCommand,
	link: linkCommand,
	student: studentCommand,
	catalogue: catalogueCommand
};
async function run(argv, io) {
	const [command, ...rest] = argv;
	if (command === void 0 || command === "--help" || command === "-h" || command === "help") {
		io.out(HELP);
		return command === void 0 ? 2 : 0;
	}
	if (command === "--version" || command === "-v" || command === "version") {
		io.out(VERSION);
		return 0;
	}
	const handler = COMMANDS[command];
	if (handler === void 0) {
		io.err(`Unknown command "${command}". The commands are: ${Object.keys(COMMANDS).join(", ")}. Run "zero-to --help" for details.`);
		return 2;
	}
	if (rest.includes("--help") || rest.includes("-h")) {
		io.out(HELP);
		return 0;
	}
	try {
		return await handler(rest, io);
	} catch (cause) {
		if (cause instanceof CliError) {
			io.err(cause.message);
			return cause.exitCode;
		}
		io.err(`zero-to stopped on an unexpected problem: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`);
		return 2;
	}
}
// src/cli/bin.ts
/**
* Entry point of the built `zero-to.mjs`. Everything else lives in `run.ts`, which tests call directly.
*/
var scriptDir = dirname(fileURLToPath(import.meta.url));
run(process.argv.slice(2), nodeIo(scriptDir)).then((code) => {
	process.exitCode = code;
}, (error) => {
	process.stderr.write(`zero-to stopped on an unexpected problem: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
	process.exitCode = 2;
});
export {};
