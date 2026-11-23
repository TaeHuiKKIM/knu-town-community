import {sceneFurniture} from "../public/campus/furniture.js";
import {chairs as libraryChairs} from "./lounge.js";

export const benches=["plaza","ginkgo"].flatMap(scene=>sceneFurniture(scene).map(item=>({...item,scene})));
// The numeric seat index is exchanged with already-open clients. Append new seats
// after the original plaza and ginkgo benches.
const outdoorSeats = [...benches.filter(t=>t.kind==="bench"),...benches.filter(t=>t.kind==="pond-bench")];
export const campusSeats=[...libraryChairs.map(c=>({...c,scene:"lounge"})),...outdoorSeats.flatMap(table=>table.seats.map((c,i)=>({...c,number:i+1,table,scene:table.scene})))];
