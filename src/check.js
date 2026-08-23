// This tests if the environment variable is active
console.log("Checking environment variable...");
const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (path) {
  console.log("✅ Success! Node found the path:", path);
} else {
  console.log("❌ Error: GOOGLE_APPLICATION_CREDENTIALS is not set.");
}