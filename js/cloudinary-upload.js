// Cloudinary Configuration
const CLOUDINARY_CLOUD_NAME = "dxawarshk";
const CLOUDINARY_UPLOAD_PRESET = "Teacher Share Zone"; // Unsigned preset configured in Cloudinary

async function uploadToCloudinary(file, onProgress) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  // Return a promise that uses XMLHttpRequest to track upload progress
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);

    // Track upload progress
    if (onProgress && xhr.upload) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          onProgress(percentComplete);
        }
      });
    }

    xhr.onload = function () {
      if (xhr.status === 200) {
        const response = JSON.parse(xhr.responseText);
        resolve({
          url: response.secure_url,
          public_id: response.public_id
        });
      } else {
        const err = JSON.parse(xhr.responseText || "{}");
        reject(new Error(err.error?.message || `Cloudinary upload failed: ${xhr.statusText}`));
      }
    };

    xhr.onerror = function () {
      reject(new Error("Network error during Cloudinary upload"));
    };

    xhr.send(formData);
  });
}

window.uploadToCloudinary = uploadToCloudinary;
