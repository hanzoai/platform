import React from 'react';

const DockerCleanupEmail = ({ projectName, cleanupDetails }: any) => {
  return (
    <div>
      <h1>Docker Cleanup Completed</h1>
      <p>Project: {projectName}</p>
      <p>Details: {cleanupDetails}</p>
    </div>
  );
};

export default DockerCleanupEmail;