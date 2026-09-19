export function shouldDismissDrawer(distance, width, velocity) {
  return distance >= width * 0.35 || (distance >= 24 && velocity <= -0.5);
}
