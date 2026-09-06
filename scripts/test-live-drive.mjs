import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;

console.log("Testing with:");
console.log("Client ID present:", Boolean(clientId));
console.log("Client Secret present:", Boolean(clientSecret));
console.log("Refresh Token present:", Boolean(refreshToken));

// 1. Get access token
console.log("\n1. Requesting fresh access token from Google OAuth...");
const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }),
});

const tokenData = await tokenRes.json();
if (!tokenRes.ok || !tokenData.access_token) {
  console.error("Token exchange failed:", tokenData);
  process.exit(1);
}
console.log("SUCCESS! Received access token.");
const accessToken = tokenData.access_token;

// 2. Ensure folder
const folderName = "Vaayu-Workspace-Projects";
console.log(`\n2. Checking for '${folderName}' folder in Google Drive...`);
const q = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and name = '${folderName}' and trashed = false`);
const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
  headers: { Authorization: `Bearer ${accessToken}` }
});
const searchData = await searchRes.json();
let folderId;
if (searchData.files && searchData.files.length > 0) {
  folderId = searchData.files[0].id;
  console.log(`SUCCESS! Found existing folder with ID: ${folderId}`);
} else {
  console.log("Creating folder...");
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  const createData = await createRes.json();
  folderId = createData.id;
  console.log(`SUCCESS! Created folder with ID: ${folderId}`);
}

// 3. Upload a small test zip file
console.log("\n3. Testing multipart upload of a test file...");
const testContent = "Vaayu Workspace Google Drive Backend Test - " + new Date().toISOString();
const form = new FormData();
form.append(
  "metadata",
  new Blob(
    [
      JSON.stringify({
        name: "test-verification.zip",
        parents: [folderId],
      }),
    ],
    { type: "application/json" }
  )
);
form.append("file", new Blob([testContent], { type: "application/zip" }), "test-verification.zip");

const uploadRes = await fetch(
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size",
  {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  }
);
const uploadData = await uploadRes.json();
if (!uploadRes.ok || !uploadData.id) {
  console.error("Upload failed:", uploadData);
  process.exit(1);
}
console.log(`SUCCESS! File uploaded to Google Drive. File ID: ${uploadData.id}, Name: ${uploadData.name}, Size: ${uploadData.size}`);

// 4. Download the file back
console.log("\n4. Testing download stream from Google Drive...");
const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}?alt=media`, {
  headers: { Authorization: `Bearer ${accessToken}` }
});
const downloadedText = await downloadRes.text();
if (downloadedText === testContent) {
  console.log("SUCCESS! Downloaded file content matches exact uploaded content.");
} else {
  console.error("Content mismatch:", downloadedText);
  process.exit(1);
}

// 5. Clean up test file
console.log("\n5. Cleaning up test file from Google Drive...");
const deleteRes = await fetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}`, {
  method: "DELETE",
  headers: { Authorization: `Bearer ${accessToken}` }
});
if (deleteRes.status === 204 || deleteRes.ok) {
  console.log("SUCCESS! Test file deleted cleanly.");
} else {
  console.log("Delete status:", deleteRes.status);
}

console.log("\nALL LIVE GOOGLE DRIVE BACKEND TESTS PASSED 100%!");
