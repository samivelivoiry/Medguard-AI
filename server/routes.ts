import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { getUncachableGitHubClient } from "./github";
import * as fs from "fs";
import * as path from "path";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Get GitHub user info
  app.get("/api/github/user", async (req, res) => {
    try {
      const octokit = await getUncachableGitHubClient();
      const { data: user } = await octokit.rest.users.getAuthenticated();
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // List user repositories
  app.get("/api/github/repos", async (req, res) => {
    try {
      const octokit = await getUncachableGitHubClient();
      const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({
        sort: "updated",
        per_page: 100
      });
      res.json(repos);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Push project to GitHub
  app.post("/api/github/push", async (req, res) => {
    try {
      const { repoName = "Medguard-AI", description = "Medguard AI Application" } = req.body || {};
      
      const octokit = await getUncachableGitHubClient();
      const { data: user } = await octokit.rest.users.getAuthenticated();
      
      // Try to create repo, or use existing one
      let repo;
      try {
        const { data } = await octokit.rest.repos.createForAuthenticatedUser({
          name: repoName,
          description: description,
          private: false,
          auto_init: false
        });
        repo = data;
      } catch (e: any) {
        if (e.status === 422) {
          // Repo already exists, get it
          const { data } = await octokit.rest.repos.get({
            owner: user.login,
            repo: repoName
          });
          repo = data;
        } else {
          throw e;
        }
      }

      // Get all files to upload
      const filesToUpload = getProjectFiles(".");
      
      // Upload each file
      const results = [];
      for (const filePath of filesToUpload) {
        try {
          const content = fs.readFileSync(filePath);
          const base64Content = content.toString("base64");
          const repoPath = filePath.startsWith("./") ? filePath.slice(2) : filePath;
          
          // Check if file exists to get its sha
          let sha: string | undefined;
          try {
            const { data: existingFile } = await octokit.rest.repos.getContent({
              owner: user.login,
              repo: repoName,
              path: repoPath
            });
            if (!Array.isArray(existingFile) && existingFile.sha) {
              sha = existingFile.sha;
            }
          } catch (e) {
            // File doesn't exist, that's fine
          }

          await octokit.rest.repos.createOrUpdateFileContents({
            owner: user.login,
            repo: repoName,
            path: repoPath,
            message: sha ? `Update ${repoPath}` : `Add ${repoPath}`,
            content: base64Content,
            sha: sha
          });
          
          results.push({ file: repoPath, status: "success" });
        } catch (error: any) {
          results.push({ file: filePath, status: "error", message: error.message });
        }
      }

      res.json({
        success: true,
        repoUrl: repo.html_url,
        filesUploaded: results.filter(r => r.status === "success").length,
        totalFiles: filesToUpload.length,
        results
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}

// Helper function to get all project files (excluding node_modules, .git, etc.)
function getProjectFiles(dir: string, files: string[] = []): string[] {
  const excludeDirs = ["node_modules", ".git", ".cache", ".config", "dist", ".replit"];
  const excludeFiles = ["package-lock.json", ".replit"];
  
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      if (!excludeDirs.includes(item) && !item.startsWith(".")) {
        getProjectFiles(fullPath, files);
      }
    } else {
      if (!excludeFiles.includes(item) && !item.startsWith(".")) {
        files.push(fullPath);
      }
    }
  }
  
  return files;
}
