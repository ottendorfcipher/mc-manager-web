"""
Cloud Function triggered by Pub/Sub budget alerts.
Shuts down Cloud Run service when budget threshold is exceeded.
"""

import base64
import json
import os
import requests
from typing import Any, Dict
from google.auth import default
from google.auth.transport.requests import Request


def budget_alert_handler(event: Dict[str, Any], context: Any) -> None:
    """
    Triggered by Pub/Sub message from GCP Budget Alert.
    
    Args:
        event: Pub/Sub event containing budget alert data
        context: Cloud Function context
    """
    # Parse the Pub/Sub message
    if 'data' not in event:
        print('No data in Pub/Sub message')
        return
    
    try:
        pubsub_data = base64.b64decode(event['data']).decode('utf-8')
        budget_notification = json.loads(pubsub_data)
    except Exception as e:
        print(f'Error parsing Pub/Sub data: {e}')
        return
    
    # Extract budget information
    cost_amount = budget_notification.get('costAmount', 0)
    budget_amount = budget_notification.get('budgetAmount', 0)
    budget_name = budget_notification.get('budgetDisplayName', 'Unknown')
    
    print(f'Budget Alert: {budget_name}')
    print(f'Current cost: ${cost_amount:.2f} / Budget: ${budget_amount:.2f}')
    
    # Get threshold from environment variable (default to $8)
    shutdown_threshold = float(os.environ.get('SHUTDOWN_THRESHOLD', '8.0'))
    
    if cost_amount >= shutdown_threshold:
        print(f'Cost ${cost_amount:.2f} >= threshold ${shutdown_threshold:.2f}')
        print('Shutting down Cloud Run service...')
        
        project_id = os.environ.get('GCP_PROJECT')
        service_name = os.environ.get('CLOUD_RUN_SERVICE', 'redstonecipher-web')
        region = os.environ.get('CLOUD_RUN_REGION', 'us-central1')
        
        if not project_id:
            print('ERROR: GCP_PROJECT environment variable not set')
            return
        
        try:
            shutdown_cloud_run(project_id, service_name, region)
            print(f'Successfully scaled {service_name} to 0 instances')
        except Exception as e:
            print(f'Error shutting down Cloud Run: {e}')
            raise
    else:
        print(f'Cost ${cost_amount:.2f} < threshold ${shutdown_threshold:.2f}')
        print('No action taken')


def shutdown_cloud_run(project_id: str, service_name: str, region: str) -> None:
    """
    Triggers Cloud Run Job to shut down the service.
    The job uses gcloud CLI which reliably updates scaling.
    
    Args:
        project_id: GCP project ID
        service_name: Name of the Cloud Run service
        region: Cloud Run region
    """
    # Get credentials
    credentials, _ = default()
    credentials.refresh(Request())
    
    # Cloud Run Jobs API endpoint
    job_name = 'budget-shutdown-job'
    job_url = f'https://run.googleapis.com/v2/projects/{project_id}/locations/{region}/jobs/{job_name}:run'
    
    headers = {
        'Authorization': f'Bearer {credentials.token}',
        'Content-Type': 'application/json'
    }
    
    # Execute the job
    print(f'Triggering shutdown job: {job_name}')
    response = requests.post(job_url, headers=headers, json={})
    
    if response.status_code == 200:
        execution = response.json()
        execution_name = execution.get('name', 'unknown')
        print(f'✓ Job execution started: {execution_name}')
        print(f'Job will scale {service_name} to 0 instances')
    else:
        print(f'Job execution response: {response.status_code}')
        print(f'Response body: {response.text}')
        response.raise_for_status()
