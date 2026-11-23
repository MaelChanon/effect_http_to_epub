import { describe, expect, it } from "@effect/vitest"
import * as Chunk from "effect/Chunk"
import * as Layout from "../src/epub/layout.js"

describe("Layout", () => {
  it("places pages like the Rust builder: first has no side, then right/left, spreads centred", () => {
    let state = Layout.empty("op")
    const sizes = [[800, 1200], [800, 1200], [800, 1200], [1600, 1200], [800, 1200]]
    for (const [w, h] of sizes) state = Layout.addPage(state, 1, w, h)[0]
    const props = Layout.join(state.spine).split("\n").filter(Boolean).map((l) => l.match(/properties="([^"]+)"/)?.[1])
    expect(props).toEqual([undefined, "page-spread-right", "page-spread-left", "rendition:page-spread-center", "page-spread-right"])
  })

  it("numbers pages per volume and adds a volume to the TOC only once it has a page", () => {
    let state = Layout.empty("op")
    const [s1, p1] = Layout.addPage(state, 1, 10, 20)
    const [s2, p2] = Layout.addPage(s1, 1, 10, 20)
    const [s3, p3] = Layout.addPage(s2, 3, 10, 20)
    state = s3
    expect([p1.name, p2.name, p3.name]).toEqual(["kcc-0000-kcc", "kcc-0001-kcc", "kcc-0000-kcc"])
    expect(p3.imagePath).toBe("OEBPS/Images/op/volume-0003/kcc-0000-kcc.jpg")
    expect(Layout.join(state.toc)).toContain("volume-0001")
    expect(Layout.join(state.toc)).not.toContain("volume-0002")
    expect(Chunk.size(state.spine)).toBe(3)
  })
})
