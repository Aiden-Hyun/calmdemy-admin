import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/firebase";
import { ContentReportStatus, ReportCategory } from "@/types";

const contentReportsCollection = collection(db, "content_reports");
const DEFAULT_REPORT_STATUS: ContentReportStatus = "open";

export async function reportContent(
  userId: string,
  contentId: string,
  contentType: string,
  category: ReportCategory,
  description?: string
): Promise<boolean> {
  try {
    await addDoc(contentReportsCollection, {
      user_id: userId,
      content_id: contentId,
      content_type: contentType,
      category,
      description: description || null,
      status: DEFAULT_REPORT_STATUS,
      reported_at: serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.error("Error reporting content:", error);
    return false;
  }
}
