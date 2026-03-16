use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ToolType {
    #[serde(rename = "claude")]
    Claude,
    #[serde(rename = "codex")]
    Codex,
}

impl ToolType {
    pub fn command(&self) -> &str {
        match self {
            ToolType::Claude => "claude",
            ToolType::Codex => "codex",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SessionStatus {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "idle")]
    Idle,
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "done")]
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub tool: ToolType,
    pub cwd: String,
    pub label: String,
    pub status: SessionStatus,
    pub created_at: u64,
}
