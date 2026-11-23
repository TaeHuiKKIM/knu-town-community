import {sceneFurniture,furnitureWidths} from "../public/campus/furniture.js";
import {chairs as libraryChairs} from "./lounge.js";

export const benches=["plaza","ginkgo"].flatMap(scene=>sceneFurniture(scene).map(item=>({...item,scene})));
// The numeric seat index is exchanged with already-open clients. Append new seats
// after the original plaza and ginkgo benches.
const outdoorSeats = [...benches.filter(t=>t.kind==="bench"),...benches.filter(t=>t.kind==="pond-bench")];
// IT4 강의실 책상(흰 책상 8개, 책상마다 의자 3개)도 웹에 그리고 앉는다.
export const lectureDesks=sceneFurniture("lecture").map(item=>({...item,scene:"lecture",width:furnitureWidths[item.kind]}));
export const campusSeats=[...libraryChairs.map(c=>({...c,scene:"lounge"})),...outdoorSeats.flatMap(table=>table.seats.map((c,i)=>({...c,number:i+1,table,scene:table.scene}))),
  ...lectureDesks.flatMap(table=>table.seats.map((c,i)=>({...c,number:i+1,table,scene:"lecture"})))];
