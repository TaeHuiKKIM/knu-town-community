import {monthKey,monthWindow} from "../public/campus/study-calendar.js";

export function sharedCalendar(value){
  if(!value || value.month!==monthKey() || !Array.isArray(value.days))return null;
  if(value.days.length!==monthWindow(value.month).count ||
    !value.days.every(minutes=>Number.isInteger(minutes)&&minutes>=0&&minutes<=1440))return null;
  return {month:value.month,days:value.days};
}
