import type { LatLng } from "../schemas/common.js";

// Demo data for the in-memory store. Fixed UUIDs so the frontend can hardcode them while
// Supabase isn't ready. Delete this file once real tables are seeded.

export const DEMO_SCHOOL_ID = "00000000-0000-4000-8000-00000000a000";
export const DEMO_USER_ID = "00000000-0000-4000-8000-00000000b001";

export const UA_CENTER: LatLng = { lat: 33.2114, lng: -87.5453 };

const cid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const SEED_COURSES = [
  { id: cid(101), code: "CS 100", title: "CS for Non-Majors", department: "Computer Science" },
  { id: cid(102), code: "CS 101", title: "Introduction to Computer Science", department: "Computer Science" },
  { id: cid(103), code: "CS 200", title: "Software Design and Engineering", department: "Computer Science" },
  { id: cid(104), code: "CS 201", title: "Data Structures and Algorithms", department: "Computer Science" },
  { id: cid(105), code: "CS 300", title: "Operating Systems", department: "Computer Science" },
  { id: cid(106), code: "MATH 125", title: "Calculus I", department: "Mathematics" },
  { id: cid(107), code: "MATH 126", title: "Calculus II", department: "Mathematics" },
  { id: cid(108), code: "MATH 227", title: "Calculus III", department: "Mathematics" },
  { id: cid(109), code: "MATH 237", title: "Linear Algebra", department: "Mathematics" },
  { id: cid(110), code: "ST 260", title: "Statistical Data Analysis", department: "Statistics" },
  { id: cid(111), code: "CH 101", title: "General Chemistry", department: "Chemistry" },
  { id: cid(112), code: "CH 102", title: "General Chemistry II", department: "Chemistry" },
  { id: cid(113), code: "BSC 114", title: "Principles of Biology I", department: "Biological Sciences" },
  { id: cid(114), code: "PH 105", title: "General Physics with Calculus", department: "Physics" },
  { id: cid(115), code: "EC 110", title: "Principles of Microeconomics", department: "Economics" },
  { id: cid(116), code: "EN 101", title: "English Composition I", department: "English" },
  { id: cid(117), code: "EN 102", title: "English Composition II", department: "English" },
  { id: cid(118), code: "ECE 225", title: "Electric Circuits", department: "Electrical & Computer Engineering" },
].map((c) => ({ ...c, school_id: DEMO_SCHOOL_ID }));

const byCode = (code: string) => SEED_COURSES.find((c) => c.code === code)!.id;

// term: null = required every term.
export const SEED_MATERIALS = [
  { course_id: byCode("MATH 125"), term: null, isbn: "9781337613927", title: "Calculus: Early Transcendentals (9e)", required: true },
  { course_id: byCode("MATH 126"), term: null, isbn: "9781337613927", title: "Calculus: Early Transcendentals (9e)", required: true },
  { course_id: byCode("CH 101"), term: null, isbn: "9780134874371", title: "Chemistry: A Molecular Approach (5e)", required: true },
  { course_id: byCode("CH 102"), term: null, isbn: "9780134874371", title: "Chemistry: A Molecular Approach (5e)", required: true },
  { course_id: byCode("BSC 114"), term: null, isbn: "9780135188743", title: "Campbell Biology (12e)", required: true },
  { course_id: byCode("EC 110"), term: null, isbn: "9780357133484", title: "Principles of Microeconomics (9e)", required: true },
  { course_id: byCode("CS 101"), term: null, isbn: "9780134444321", title: "Starting Out with Python (4e)", required: false },
  { course_id: byCode("PH 105"), term: null, isbn: "9781119773511", title: "Fundamentals of Physics (12e)", required: true },
];

// Approximate UA building coordinates for turning a calendar event's location into a Place.
// TODO: verify against the campus map before the demo.
export const UA_BUILDINGS: { name: string; aliases: string[]; location: LatLng }[] = [
  { name: "Gorgas Library", aliases: ["gorgas"], location: { lat: 33.2113, lng: -87.5461 } },
  { name: "Rodgers Library", aliases: ["rodgers"], location: { lat: 33.2156, lng: -87.5418 } },
  { name: "Shelby Hall", aliases: ["shelby"], location: { lat: 33.2148, lng: -87.5432 } },
  { name: "Science and Engineering Complex", aliases: ["sec", "science and engineering"], location: { lat: 33.2172, lng: -87.5436 } },
  { name: "H.M. Comer Hall", aliases: ["comer", "hm comer", "h.m. comer"], location: { lat: 33.2145, lng: -87.5452 } },
  { name: "Hardaway Hall", aliases: ["hardaway"], location: { lat: 33.2138, lng: -87.5446 } },
  { name: "Gordon Palmer Hall", aliases: ["gordon palmer", "palmer"], location: { lat: 33.2124, lng: -87.5440 } },
  { name: "Lloyd Hall", aliases: ["lloyd"], location: { lat: 33.2108, lng: -87.5430 } },
  { name: "Bidgood Hall", aliases: ["bidgood"], location: { lat: 33.2103, lng: -87.5478 } },
  { name: "Alston Hall", aliases: ["alston"], location: { lat: 33.2099, lng: -87.5487 } },
  { name: "Ten Hoor Hall", aliases: ["ten hoor"], location: { lat: 33.2132, lng: -87.5420 } },
  { name: "Morgan Hall", aliases: ["morgan"], location: { lat: 33.2101, lng: -87.5450 } },
  { name: "Nott Hall", aliases: ["nott"], location: { lat: 33.2122, lng: -87.5420 } },
  { name: "Russell Hall", aliases: ["russell"], location: { lat: 33.2118, lng: -87.5428 } },
  { name: "Ferguson Student Center", aliases: ["ferguson", "fergie"], location: { lat: 33.2148, lng: -87.5468 } },
];
