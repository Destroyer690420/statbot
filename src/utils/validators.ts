import { REDDIT_URL_PATTERN, MAX_NOTES_LENGTH, SUPPORTED_IMAGE_EXTENSIONS, TASK_ID_PATTERN } from '../config/constants';

/**
 * Validates a Reddit URL format.
 */
export function isValidRedditUrl(url: string): boolean {
  return REDDIT_URL_PATTERN.test(url.trim());
}

/**
 * Validates notes length.
 */
export function isValidNotes(notes: string): boolean {
  return notes.length <= MAX_NOTES_LENGTH;
}

/**
 * Checks if a file extension is a supported image type.
 */
export function isSupportedImage(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return false;
  return (SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Sanitizes a string for safe display.
 */
export function sanitize(input: string): string {
  return input.replace(/[<>@&]/g, '').trim();
}

/**
 * Validates a custom task ID format.
 */
export function isValidTaskId(id: string): boolean {
  return TASK_ID_PATTERN.test(id);
}

/**
 * Validates that a string is a valid Discord snowflake ID.
 */
export function isValidSnowflake(id: string): boolean {
  return /^\d{17,20}$/.test(id);
}
