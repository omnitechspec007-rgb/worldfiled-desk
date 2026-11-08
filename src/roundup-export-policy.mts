/** Keep browser-side poster and video export unavailable until editorial clearance is current and at least one story remains. */
export function canExportRoundup(exportReady: boolean, storyCount: number): boolean {
  return exportReady === true && Number.isInteger(storyCount) && storyCount > 0;
}
