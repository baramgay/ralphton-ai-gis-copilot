import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// server-only throws outside Next server graphs; unit tests import API/server modules.
vi.mock("server-only", () => ({}));

afterEach(() => cleanup());
