public with sharing class ExpenseApproverConsoleController {

    public class PendingApprovalRow {
        @AuraEnabled public Id workItemId;
        @AuraEnabled public Id processInstanceId;
        @AuraEnabled public Id claimId;

        @AuraEnabled public String claimName;
        @AuraEnabled public String status;
        @AuraEnabled public Decimal totalExpenseAmount;
        @AuraEnabled public Datetime submitDate;

        @AuraEnabled public String employeeName;
        @AuraEnabled public Id employeeId;

        @AuraEnabled public String assignedTo; // User or Queue name
    }

    public class FileRow {
        @AuraEnabled public Id contentDocumentId;
        @AuraEnabled public String title;
        @AuraEnabled public Datetime linkedOn;
        @AuraEnabled public String fileUrl;
    }

    public class ClaimDetails {
        @AuraEnabled public Expense_Claim__c claim;
        @AuraEnabled public List<Expense_Line_Item__c> lineItems;
        @AuraEnabled public List<FileRow> receipts;
    }

    // --- 1) Pending approvals for user + queues user belongs to ---
    @AuraEnabled(cacheable=true)
    public static List<PendingApprovalRow> getMyPendingApprovals() {
        Id userId = UserInfo.getUserId();

        // Queues the user belongs to
        Set<Id> queueIds = new Set<Id>();
        for (GroupMember gm : [
            SELECT GroupId
            FROM GroupMember
            WHERE UserOrGroupId = :userId
        ]) {
            queueIds.add(gm.GroupId);
        }

        Set<Id> actorIds = new Set<Id>();
        actorIds.add(userId);
        actorIds.addAll(queueIds);

        // Work items assigned to user or user's queues
        List<ProcessInstanceWorkitem> wis = [
            SELECT Id,
                   ActorId,
                   ProcessInstanceId,
                   CreatedDate,
                   ProcessInstance.TargetObjectId
            FROM ProcessInstanceWorkitem
            WHERE ActorId IN :actorIds
            ORDER BY CreatedDate DESC
            LIMIT 200
        ];

        // Collect claim IDs
        Set<Id> claimIds = new Set<Id>();
        for (ProcessInstanceWorkitem wi : wis) {
            if (wi.ProcessInstance != null && wi.ProcessInstance.TargetObjectId != null) {
                claimIds.add(wi.ProcessInstance.TargetObjectId);
            }
        }

        // Pull claim info
        Map<Id, Expense_Claim__c> claims = claimIds.isEmpty()
            ? new Map<Id, Expense_Claim__c>()
            : new Map<Id, Expense_Claim__c>([
                SELECT Id, Name, Status__c, Total_Expense_Amount__c, Submit_Date__c,
                       Employee__c, Employee__r.Name
                FROM Expense_Claim__c
                WHERE Id IN :claimIds
            ]);

        // Actor names (user/queue)
        Set<Id> actorLookup = new Set<Id>();
        for (ProcessInstanceWorkitem wi : wis) actorLookup.add(wi.ActorId);

        Map<Id, Group> groups = actorLookup.isEmpty()
            ? new Map<Id, Group>()
            : new Map<Id, Group>([
                SELECT Id, Name, Type
                FROM Group
                WHERE Id IN :actorLookup
            ]);

        Map<Id, User> users = actorLookup.isEmpty()
            ? new Map<Id, User>()
            : new Map<Id, User>([
                SELECT Id, Name
                FROM User
                WHERE Id IN :actorLookup
            ]);

        List<PendingApprovalRow> out = new List<PendingApprovalRow>();

        for (ProcessInstanceWorkitem wi : wis) {
            Id cid = wi.ProcessInstance.TargetObjectId;
            if (!claims.containsKey(cid)) continue;

            Expense_Claim__c c = claims.get(cid);

            PendingApprovalRow row = new PendingApprovalRow();
            row.workItemId = wi.Id;
            row.processInstanceId = wi.ProcessInstanceId;
            row.claimId = c.Id;

            row.claimName = c.Name;
            row.status = c.Status__c;
            row.totalExpenseAmount = c.Total_Expense_Amount__c;
            row.submitDate = c.Submit_Date__c;

            row.employeeId = c.Employee__c;
            row.employeeName = (c.Employee__r != null) ? c.Employee__r.Name : null;

            // Assigned-to label
            if (users.containsKey(wi.ActorId)) row.assignedTo = 'User: ' + users.get(wi.ActorId).Name;
            else if (groups.containsKey(wi.ActorId)) row.assignedTo = 'Queue: ' + groups.get(wi.ActorId).Name;
            else row.assignedTo = 'Assigned';

            out.add(row);
        }

        return out;
    }

    // --- 2) Claim details + line items + receipts ---
    @AuraEnabled(cacheable=true)
    public static ClaimDetails getClaimDetails(Id claimId) {
        ClaimDetails cd = new ClaimDetails();

        cd.claim = [
            SELECT Id, Name, Status__c, Total_Expense_Amount__c, Submit_Date__c,
                   Cost_Center__c, Business_Justification__c, Employee__c, Employee__r.Name
            FROM Expense_Claim__c
            WHERE Id = :claimId
            LIMIT 1
        ];

        cd.lineItems = [
            SELECT Id, Name, Expense_Type__c, Expense_Date__c, Amount__c, Merchant_Vendor__c, Description__c,
                   Receipt_Required__c, Receipt_Attached__c
            FROM Expense_Line_Item__c
            WHERE Expense_Claim__c = :claimId
            ORDER BY Expense_Date__c DESC NULLS LAST, CreatedDate DESC
        ];

        // Receipts attached to claim
        List<ContentDocumentLink> links = [
            SELECT ContentDocumentId, LinkedEntityId, SystemModstamp,
                   ContentDocument.Title, ContentDocument.CreatedDate
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :claimId
            ORDER BY SystemModstamp DESC
            LIMIT 50
        ];

        List<FileRow> files = new List<FileRow>();
        for (ContentDocumentLink l : links) {
            FileRow fr = new FileRow();
            fr.contentDocumentId = l.ContentDocumentId;
            fr.title = l.ContentDocument != null ? l.ContentDocument.Title : 'Receipt';
            fr.linkedOn = l.SystemModstamp;

            // Standard Salesforce file viewer
            fr.fileUrl = '/lightning/r/ContentDocument/' + l.ContentDocumentId + '/view';
            files.add(fr);
        }
        cd.receipts = files;

        return cd;
    }

    // --- 3) Approve / Reject ---
    @AuraEnabled
    public static void approveWorkItem(Id workItemId, String comments) {
        Approval.ProcessWorkitemRequest req = new Approval.ProcessWorkitemRequest();
        req.setWorkitemId(workItemId);
        req.setAction('Approve');
        if (comments != null) req.setComments(comments);

        Approval.ProcessResult res = Approval.process(req);
        if (!res.isSuccess()) {
            throw new AuraHandledException('Approve failed. Check approval configuration.');
        }
    }

    @AuraEnabled
    public static void rejectWorkItem(Id workItemId, String comments) {
        if (String.isBlank(comments)) {
            throw new AuraHandledException('Rejection comments are required.');
        }

        Approval.ProcessWorkitemRequest req = new Approval.ProcessWorkitemRequest();
        req.setWorkitemId(workItemId);
        req.setAction('Reject');
        req.setComments(comments);

        Approval.ProcessResult res = Approval.process(req);
        if (!res.isSuccess()) {
            throw new AuraHandledException('Reject failed. Check approval configuration.');
        }
    }
}
