const matcherPath = "@testing-library/jest-native/extend-expect";
import(matcherPath).catch(() => {
  // Optional in this repo; keep tests running even if jest-native matchers are not installed.
});
