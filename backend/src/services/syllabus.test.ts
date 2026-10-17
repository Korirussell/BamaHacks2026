import assert from "node:assert/strict";
import test from "node:test";
import { parseSyllabusText, rowsToText } from "./syllabus.js";

const ctx = { term: "Fall 2026", timezone: "America/Chicago" };

const SYLLABUS = `
CS 201: Data Structures — Fall 2026
Instructor: Dr. Smith   Office hours: Mon 2:00-3:30 pm, SEC 3409
Grading: Homework 30%, Quizzes 10%, Midterm 25%, Final 35%
Final grades are posted on Blackboard by Dec 18.

Week 2 | Aug 27 | Linked lists | Homework 1 due 11:59 pm
Week 4 | 9/10 | Stacks and queues | Quiz 1
Week 6 | Tuesday, September 22 | Exam 1 review session
Week 7 | Tuesday, October 24 | Midterm Exam (Chapters 1-5) in class, 9:30 a.m.
Homework 4 assigned Oct 1, due Oct 8 at noon
Project proposal due 10/30/26
Week 12 — Thu., Nov. 19th: Quiz 3 (trees)
Final Exam: Monday, December 7, 8:00–10:30 a.m., Shelby 1103
Paper 2 due Jan 4
Thanksgiving break Nov 25-27, no class
`;

test("the syllabus parser pulls dated graded items in several date formats", () => {
  const { events } = parseSyllabusText(SYLLABUS, ctx);
  const brief = events.map((e) => [e.kind, e.date, e.time, e.title]);
  assert.deepEqual(brief, [
    ["assignment", "2026-08-27", "23:59", "Linked lists Homework 1"],
    ["quiz", "2026-09-10", null, "Stacks and queues Quiz 1"],
    ["assignment", "2026-10-08", "12:00", "Homework 4 assigned"],
    ["exam", "2026-10-24", "09:30", "Midterm Exam (Chapters 1-5) in class"],
    ["project", "2026-10-30", null, "Project proposal"],
    ["quiz", "2026-11-19", null, "Quiz 3 (trees)"],
    ["exam", "2026-12-07", "08:00", "Final Exam: Shelby 1103"],
    ["project", "2027-01-04", null, "Paper 2"],
  ]);
});

test("due_at is wall-clock time in the school's zone, with defaults when no time is given", () => {
  const { events } = parseSyllabusText(SYLLABUS, ctx);
  const byTitle = new Map(events.map((e) => [e.title, e.due_at]));
  assert.equal(byTitle.get("Midterm Exam (Chapters 1-5) in class"), "2026-10-24T14:30:00.000Z"); // CDT
  assert.equal(byTitle.get("Quiz 3 (trees)"), "2026-11-19T14:00:00.000Z"); // CST, exam/quiz default 08:00
  assert.equal(byTitle.get("Project proposal"), "2026-10-31T04:59:00.000Z"); // 23:59 CDT
});

test("non-graded dated lines, review sessions and impossible dates are skipped", () => {
  assert.deepEqual(parseSyllabusText("Final grades posted Dec 18\nExam 2 review Nov 3\nHW 9 due 2/30\nOffice hours Oct 3", ctx).events, []);
});

test("spring terms keep the term's year and PDF rows join into lines", () => {
  const text = rowsToText([["Week 3", "Feb 5", "Quiz 2"], ["Week 9", "March 18, 2027", "Midterm"]]);
  const { events } = parseSyllabusText(text, { term: "Spring 2027", timezone: "America/Chicago" });
  assert.deepEqual(events.map((e) => [e.kind, e.date, e.title]), [["quiz", "2027-02-05", "Quiz 2"], ["exam", "2027-03-18", "Midterm"]]);
});

test("duplicate lines collapse to one event", () => {
  assert.equal(parseSyllabusText("Quiz 1 Sep 10\nQuiz 1 Sep 10", ctx).events.length, 1);
});
