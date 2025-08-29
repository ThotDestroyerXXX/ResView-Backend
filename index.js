import express from "express";
import pdfParse from "pdf-parse";
import Replicate from "replicate";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";

dotenv.config();

const app = express();

app.use(cors());

app.use(express.json());

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Route to upload resume and analyze
app.post("/analyze", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const dataBuffer = req.file.buffer;
    const pdfData = await pdfParse(dataBuffer);

    const resumeText = pdfData.text;

    // Prompt for Granite model
    const prompt = `
    You are an AI Resume Reviewer. Analyze the following resume in detail and return JSON ONLY in this exact format:
    {
      "overall": {
        "score": [number between 1-10 with one decimal place],
        "rating_text": [one of: "Poor", "Below Average", "Average", "Above Average", "Excellent"],
        "stars": [number 1-5],
        "summary": [brief one-sentence evaluation]
      },
      "ratings": {
        "clarity_formatting": [number between 1-10 with one decimal place],
        "skills_relevance": [number between 1-10 with one decimal place],
        "experience_strength": [number between 1-10 with one decimal place],
        "overall_presentation": [number between 1-10 with one decimal place]
      },
      "skills_analysis": [
        {
          "name": [skill name extracted from resume],
          "color": [color associated with the skill],
          "value": [percentage representing relative importance, all values should sum to 100]
        }
      ],
      "experience_analysis": [
        { 
          "category": [name of category], 
          "score": [score between 1-100],
        },
      ],
      "suggestions": {
        "strengths": [
          [string - first strength point],
          [string - second strength point],
          [string - third strength point]
        ],
        "improvements": [
          [string - first improvement point],
          [string - second improvement point],
          [string - third improvement point]
        ]
      }
    }

    Guidelines:
    1. For the overall score, use a scale where 1-4 is poor, 4-6 is average, 6-8 is good, 8-9 is very good, and 9-10 is excellent
    2. For star ratings: 1-2 = 1 star, 3-4 = 2 stars, 5-6 = 3 stars, 7-8 = 4 stars, 9-10 = 5 stars
    3. For strengths and improvements, be specific and actionable
    4. For skills_analysis, evaluate based on both mentioned skills and implied capabilities
    5. For experience_analysis, evaluate:
      - Relevance: how relevant previous roles are to typical career progression
      - Impact: evidence of meaningful contributions and results
      - Progression: clear career advancement over time
      - Achievements: quantifiable or notable accomplishments
    6. Include 4-6 most important skills from the resume. The color can be anything in #RRGGBB format. The percentage is arbitrary, which means you could assign any value that makes sense for the skill's importance.
    7. Each suggestion should be a complete sentence with specific advice
    8. Make sure that the JSON is a valid JSON format. Check again if there is missing or extra commas, brackets, or quotes.
    9. DO NOT include any explanations or text outside the JSON structure
    10. Experience analysis includes 4 categories in an array: "Relevance", "Impact", "Progression", "Achievements". Each of them can have a score between 1-100. The score is arbitrary and should reflect the candidate's experience in each area.
    
    Resume Text:
    ${resumeText}
    `;

    try {
      const output = await replicate.run(
        "ibm-granite/granite-3.3-8b-instruct",
        {
          input: { prompt },
        }
      );

      // Join output and try to extract valid JSON
      const outputStr = output.join("");
      console.log("Raw model output:", outputStr);

      // Find JSON content - look for content between first { and last }
      let jsonStr;
      try {
        const firstBrace = outputStr.indexOf("{");
        const lastBrace = outputStr.lastIndexOf("}");

        if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
          throw new Error("Could not find valid JSON structure");
        }

        jsonStr = outputStr.substring(firstBrace, lastBrace + 1);
        const result = JSON.parse(jsonStr);

        res.json(result);
      } catch (parseErr) {
        console.error("Error parsing JSON:", parseErr);
        console.error("Attempted to parse:", jsonStr);

        res
          .status(500)
          .json({ error: "Failed to parse AI response. Please try again." });
      }
    } catch (replicateErr) {
      console.error("Error with Replicate API:", replicateErr);
      res.status(500).json({
        error: "Error connecting to AI service. Please try again later.",
      });
    }
  } catch (err) {
    console.error("Error analyzing resume:", err);
    res.status(500).json({ error: `Error analyzing resume: ${err.message}` });
  }
});

app.get("/", (req, res) => {
  res.send("Welcome to the Resume Analysis API");
});

app.listen(process.env.PORT || 8000, () => {
  console.log(
    `Backend running on http://localhost:${process.env.PORT || 8000}`
  );
});
