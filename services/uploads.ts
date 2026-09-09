const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
export async function uploadImage(file: File) {
  if (!cloudName || !uploadPreset)
    throw new Error('Image uploads are not configured.');
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 10 * 1024 * 1024)
    throw new Error('Images must be under 10 MB.');
  const body = new FormData();
  body.append('file', file);
  body.append('upload_preset', uploadPreset);
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: 'POST', body },
  );
  if (!response.ok) throw new Error('The image could not be uploaded.');
  const data = (await response.json()) as { secure_url?: string };
  if (!data.secure_url)
    throw new Error('The upload did not return an image URL.');
  return data.secure_url;
}
