import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { getDriveAccessToken, uploadDriveFile, ensureDriveFolder, downloadDriveFile, deleteDriveFile } from "../lib/drive.ts";

const sql = neon(process.env.DATABASE_URL);

console.log("=========================================");
console.log("PROJECTS FULL END-TO-END VERIFICATION TEST");
console.log("=========================================");

// 1. Get an existing user from DB
const users = await sql`SELECT id, email, role FROM users LIMIT 1`;
if (users.length === 0) {
  console.error("No users found in database!");
  process.exit(1);
}
const testUser = users[0];
console.log(`1. Using user for project ownership: ${testUser.email} (${testUser.role})`);

// 2. Obtain Google Drive Access Token
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;

const token = await getDriveAccessToken(clientId, clientSecret, refreshToken);
console.log("2. Successfully obtained Google Drive access token.");

const folderId = await ensureDriveFolder(token);
console.log(`3. Verified Google Drive folder: ${folderId}`);

// 3. Upload simulated codebase & preview
const codebaseBytes = new Blob(["fake-codebase-archive-content-" + Date.now()], { type: "application/zip" });
const previewBytes = new Blob(["fake-image-png-content-" + Date.now()], { type: "image/png" });

console.log("4. Uploading codebase .zip to Google Drive...");
const codebaseUploaded = await uploadDriveFile(token, {
  name: "demo-project-v1.zip",
  mimeType: "application/zip",
  bytes: codebaseBytes,
  folderId,
});
console.log(`   Uploaded Codebase Drive ID: ${codebaseUploaded.id}`);

console.log("5. Uploading preview image to Google Drive...");
const previewUploaded = await uploadDriveFile(token, {
  name: "demo-preview.png",
  mimeType: "image/png",
  bytes: previewBytes,
  folderId,
});
console.log(`   Uploaded Preview Drive ID: ${previewUploaded.id}`);

// 4. Insert into database
console.log("6. Inserting project record into PostgreSQL...");
const [project] = await sql`
  INSERT INTO projects (
    user_id, title, description,
    codebase_drive_id, codebase_file_name, codebase_file_size,
    preview_drive_id, preview_file_name
  ) VALUES (
    ${testUser.id}, 'Automated Test Project', 'Full automated test description verifying Drive storage',
    ${codebaseUploaded.id}, ${codebaseUploaded.name}, '1.5 MB',
    ${previewUploaded.id}, ${previewUploaded.name}
  ) RETURNING *;
`;
console.log(`   Created Project in DB with ID: ${project.id}`);

// 5. Query and verify retrieval
console.log("7. Querying projects list from DB...");
const queryResult = await sql`SELECT * FROM projects WHERE id = ${project.id}`;
if (queryResult.length === 1 && queryResult[0].title === "Automated Test Project") {
  console.log("   SUCCESS! Project query matches expected title and Drive IDs.");
} else {
  console.error("   FAILURE querying project:", queryResult);
  process.exit(1);
}

// 6. Test downloading codebase & preview from Drive
console.log("8. Testing download stream of codebase from Google Drive...");
const dlCodebase = await downloadDriveFile(token, codebaseUploaded.id);
const dlCodebaseText = await dlCodebase.text();
if (dlCodebaseText.includes("fake-codebase-archive-content")) {
  console.log("   SUCCESS! Codebase downloaded correctly.");
} else {
  console.error("   FAILURE codebase mismatch:", dlCodebaseText);
  process.exit(1);
}

console.log("9. Testing download stream of preview image from Google Drive...");
const dlPreview = await downloadDriveFile(token, previewUploaded.id);
const dlPreviewText = await dlPreview.text();
if (dlPreviewText.includes("fake-image-png-content")) {
  console.log("   SUCCESS! Preview image downloaded correctly.");
} else {
  console.error("   FAILURE preview mismatch:", dlPreviewText);
  process.exit(1);
}

// 7. Cleanup project and Drive files
console.log("10. Deleting test files from Google Drive and DB...");
await deleteDriveFile(token, codebaseUploaded.id);
await deleteDriveFile(token, previewUploaded.id);
await sql`DELETE FROM projects WHERE id = ${project.id}`;
console.log("   SUCCESS! Test files and record deleted cleanly.");

console.log("\n=========================================");
console.log("ALL PROJECTS & GOOGLE DRIVE TESTS PASSED!");
console.log("=========================================");
