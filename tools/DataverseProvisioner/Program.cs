using System.ServiceModel;
using Azure.Core;
using Azure.Identity;
using Microsoft.Crm.Sdk.Messages;
using Microsoft.PowerPlatform.Dataverse.Client;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Metadata;

const string DataverseUrl = "https://bprocidatest.crm.dynamics.com/";
const string TenantId = "1557f771-4c8e-4dbd-8b80-dd00a88e833e";
const string DataverseToolingClientId = "51f81489-12ee-4a9e-aaae-a2591f45987d";
const string SolutionUniqueName = "DataverseStorageReport";
const string PublisherUniqueName = "DataverseStorageReportPublisher";
const string Prefix = "dsr";
const int LanguageCode = 1033;

var credential = new InteractiveBrowserCredential(new InteractiveBrowserCredentialOptions
{
    TenantId = TenantId,
    ClientId = DataverseToolingClientId,
    RedirectUri = new Uri("http://localhost"),
});

using var service = new ServiceClient(new Uri(DataverseUrl), async _ =>
{
    var token = await credential.GetTokenAsync(
        new TokenRequestContext(new[] { $"{DataverseUrl.TrimEnd('/')}/.default" }));
    return token.Token;
});
if (!service.IsReady)
{
    throw new InvalidOperationException($"Dataverse connection failed: {service.LastError}", service.LastException);
}

Console.WriteLine($"Connected to {DataverseUrl}");

var publisherId = EnsurePublisher(service);
EnsureSolution(service, publisherId);

// dsr_environment
EnsureTable(service, "dsr_Environment", "Environment", "Environments", "dsr_Name", "Name");
EnsureText(service, "dsr_environment", "dsr_EnvironmentGuid", "Environment GUID", 100);
EnsureText(service, "dsr_environment", "dsr_DisplayName", "Display Name", 250);
EnsureText(service, "dsr_environment", "dsr_Type", "Type", 100);
EnsureText(service, "dsr_environment", "dsr_Region", "Region", 100);
EnsureText(service, "dsr_environment", "dsr_OwnerEmail", "Owner Email", 250);
EnsureText(service, "dsr_environment", "dsr_OwnerName", "Owner Name", 250);
EnsureText(service, "dsr_environment", "dsr_BillingModel", "Billing Model", 100);
EnsureText(service, "dsr_environment", "dsr_PayGoSubscriptionId", "PayGo Subscription Id", 250);
EnsureText(service, "dsr_environment", "dsr_Url", "Url", 500);
EnsureKey(service, "dsr_environment", "dsr_Environment_EnvironmentGuid", "dsr_environmentguid");

// dsr_storagesnapshot
EnsureTable(service, "dsr_StorageSnapshot", "Storage Snapshot", "Storage Snapshots", "dsr_Name", "Name");
EnsureDateTime(service, "dsr_storagesnapshot", "dsr_CapturedAt", "Captured At");
EnsureDecimal(service, "dsr_storagesnapshot", "dsr_DbAllocatedGb", "Database Allocated GB");
EnsureDecimal(service, "dsr_storagesnapshot", "dsr_DbUsedGb", "Database Used GB");
EnsureDecimal(service, "dsr_storagesnapshot", "dsr_FileAllocatedGb", "File Allocated GB");
EnsureDecimal(service, "dsr_storagesnapshot", "dsr_FileUsedGb", "File Used GB");
EnsureDecimal(service, "dsr_storagesnapshot", "dsr_LogAllocatedGb", "Log Allocated GB");
EnsureDecimal(service, "dsr_storagesnapshot", "dsr_LogUsedGb", "Log Used GB");
EnsureBoolean(service, "dsr_storagesnapshot", "dsr_PayGoEnabled", "PayGo Enabled");
EnsureDecimal(service, "dsr_storagesnapshot", "dsr_PayGoConsumptionGb", "PayGo Consumption GB");
EnsureDecimal(service, "dsr_storagesnapshot", "dsr_OverageGb", "Overage GB");
EnsureLookup(service, "dsr_environment", "dsr_storagesnapshot", "dsr_environment", "dsr_Environment_StorageSnapshot");

// dsr_tenantpool
EnsureTable(service, "dsr_TenantPool", "Tenant Pool", "Tenant Pools", "dsr_Name", "Name");
EnsureDateTime(service, "dsr_tenantpool", "dsr_CapturedAt", "Captured At");
EnsureDecimal(service, "dsr_tenantpool", "dsr_TotalAllocatedGb", "Total Allocated GB");
EnsureDecimal(service, "dsr_tenantpool", "dsr_TotalUsedGb", "Total Used GB");
EnsureDecimal(service, "dsr_tenantpool", "dsr_AvailableGb", "Available GB");
EnsureDecimal(service, "dsr_tenantpool", "dsr_PayGoAccrualGb", "PayGo Accrual GB");

// dsr_setting
EnsureTable(service, "dsr_Setting", "Setting", "Settings", "dsr_Name", "Name");
EnsureInteger(service, "dsr_setting", "dsr_WarnPercent", "Warn Percent");
EnsureInteger(service, "dsr_setting", "dsr_CriticalPercent", "Critical Percent");
EnsureText(service, "dsr_setting", "dsr_DefaultEnvironmentTypes", "Default Environment Types", 500);

Publish(service);

Console.WriteLine("Dataverse provisioning complete.");

static Guid EnsurePublisher(IOrganizationService service)
{
    var existing = First(service, "publisher", "uniquename", PublisherUniqueName, "publisherid");
    if (existing is not null) return existing.Id;

    var publisher = new Entity("publisher")
    {
        ["uniquename"] = PublisherUniqueName,
        ["friendlyname"] = "Dataverse Storage Report Publisher",
        ["customizationprefix"] = Prefix,
        ["customizationoptionvalueprefix"] = 77510,
    };
    var id = service.Create(publisher);
    Console.WriteLine("Created publisher.");
    return id;
}

static void EnsureSolution(IOrganizationService service, Guid publisherId)
{
    if (First(service, "solution", "uniquename", SolutionUniqueName, "solutionid") is not null)
    {
        Console.WriteLine("Solution exists.");
        return;
    }

    var solution = new Entity("solution")
    {
        ["uniquename"] = SolutionUniqueName,
        ["friendlyname"] = "Dataverse Storage Report",
        ["version"] = "1.0.0.0",
        ["publisherid"] = new EntityReference("publisher", publisherId),
    };
    service.Create(solution);
    Console.WriteLine("Created solution.");
}

static void EnsureTable(IOrganizationService service, string schemaName, string displayName, string pluralName, string primarySchemaName, string primaryDisplayName)
{
    var logicalName = schemaName.ToLowerInvariant();
    if (EntityExists(service, logicalName))
    {
        Console.WriteLine($"Table exists: {logicalName}");
        return;
    }

    var entity = new EntityMetadata
    {
        SchemaName = schemaName,
        DisplayName = Label(displayName),
        DisplayCollectionName = Label(pluralName),
        Description = Label(displayName),
        OwnershipType = OwnershipTypes.UserOwned,
        IsActivity = false,
    };
    var primary = new StringAttributeMetadata
    {
        SchemaName = primarySchemaName,
        DisplayName = Label(primaryDisplayName),
        RequiredLevel = None(),
        MaxLength = 500,
    };
    service.Execute(new CreateEntityRequest
    {
        Entity = entity,
        PrimaryAttribute = primary,
        SolutionUniqueName = SolutionUniqueName,
    });
    Console.WriteLine($"Created table: {logicalName}");
}

static void EnsureText(IOrganizationService service, string table, string schemaName, string displayName, int maxLength)
{
    EnsureAttribute(service, table, schemaName, () => new StringAttributeMetadata
    {
        SchemaName = schemaName,
        DisplayName = Label(displayName),
        RequiredLevel = None(),
        MaxLength = maxLength,
    });
}

static void EnsureDecimal(IOrganizationService service, string table, string schemaName, string displayName)
{
    EnsureAttribute(service, table, schemaName, () => new DecimalAttributeMetadata
    {
        SchemaName = schemaName,
        DisplayName = Label(displayName),
        RequiredLevel = None(),
        Precision = 2,
        MinValue = 0m,
        MaxValue = 100000000m,
    });
}

static void EnsureInteger(IOrganizationService service, string table, string schemaName, string displayName)
{
    EnsureAttribute(service, table, schemaName, () => new IntegerAttributeMetadata
    {
        SchemaName = schemaName,
        DisplayName = Label(displayName),
        RequiredLevel = None(),
        MinValue = 0,
        MaxValue = 1000,
    });
}

static void EnsureDateTime(IOrganizationService service, string table, string schemaName, string displayName)
{
    EnsureAttribute(service, table, schemaName, () => new DateTimeAttributeMetadata
    {
        SchemaName = schemaName,
        DisplayName = Label(displayName),
        RequiredLevel = None(),
        Format = DateTimeFormat.DateAndTime,
    });
}

static void EnsureBoolean(IOrganizationService service, string table, string schemaName, string displayName)
{
    EnsureAttribute(service, table, schemaName, () => new BooleanAttributeMetadata
    {
        SchemaName = schemaName,
        DisplayName = Label(displayName),
        RequiredLevel = None(),
        OptionSet = new BooleanOptionSetMetadata(
            new OptionMetadata(Label("Yes"), 1),
            new OptionMetadata(Label("No"), 0)),
    });
}

static void EnsureAttribute(IOrganizationService service, string table, string schemaName, Func<AttributeMetadata> createAttribute)
{
    var logicalName = schemaName.ToLowerInvariant();
    if (AttributeExists(service, table, logicalName)) return;

    service.Execute(new CreateAttributeRequest
    {
        EntityName = table,
        Attribute = createAttribute(),
        SolutionUniqueName = SolutionUniqueName,
    });
    Console.WriteLine($"Created attribute: {table}.{logicalName}");
}

static void EnsureLookup(IOrganizationService service, string referencedEntity, string referencingEntity, string referencingAttribute, string schemaName)
{
    if (AttributeExists(service, referencingEntity, referencingAttribute)) return;

    service.Execute(new CreateOneToManyRequest
    {
        OneToManyRelationship = new OneToManyRelationshipMetadata
        {
            SchemaName = schemaName,
            ReferencedEntity = referencedEntity,
            ReferencingEntity = referencingEntity,
            CascadeConfiguration = new CascadeConfiguration
            {
                Assign = CascadeType.NoCascade,
                Delete = CascadeType.RemoveLink,
                Merge = CascadeType.NoCascade,
                Reparent = CascadeType.NoCascade,
                Share = CascadeType.NoCascade,
                Unshare = CascadeType.NoCascade,
            },
        },
        Lookup = new LookupAttributeMetadata
        {
            SchemaName = ToLookupSchemaName(referencingAttribute),
            DisplayName = Label(ToDisplayName(referencingAttribute)),
            RequiredLevel = None(),
        },
        SolutionUniqueName = SolutionUniqueName,
    });
    Console.WriteLine($"Created lookup: {referencingEntity}.{referencingAttribute}");
}

static void EnsureKey(IOrganizationService service, string table, string schemaName, string attributeName)
{
    try
    {
        service.Execute(new CreateEntityKeyRequest
        {
            EntityName = table,
            EntityKey = new EntityKeyMetadata
            {
                SchemaName = schemaName,
                DisplayName = Label(schemaName.Replace("_", " ")),
                KeyAttributes = new[] { attributeName },
            },
            SolutionUniqueName = SolutionUniqueName,
        });
        Console.WriteLine($"Created key: {schemaName}");
    }
    catch (FaultException<OrganizationServiceFault> ex) when (IsAlreadyExists(ex))
    {
    }
}

static Entity? First(IOrganizationService service, string table, string attribute, object value, string idColumn)
{
    var query = new Microsoft.Xrm.Sdk.Query.QueryExpression(table)
    {
        ColumnSet = new Microsoft.Xrm.Sdk.Query.ColumnSet(idColumn),
        TopCount = 1,
    };
    query.Criteria.AddCondition(attribute, Microsoft.Xrm.Sdk.Query.ConditionOperator.Equal, value);
    return service.RetrieveMultiple(query).Entities.FirstOrDefault();
}

static bool EntityExists(IOrganizationService service, string logicalName)
{
    try
    {
        service.Execute(new RetrieveEntityRequest { LogicalName = logicalName, EntityFilters = EntityFilters.Entity });
        return true;
    }
    catch (FaultException<OrganizationServiceFault>) { return false; }
}

static bool AttributeExists(IOrganizationService service, string entityName, string logicalName)
{
    try
    {
        service.Execute(new RetrieveAttributeRequest { EntityLogicalName = entityName, LogicalName = logicalName });
        return true;
    }
    catch (FaultException<OrganizationServiceFault>) { return false; }
}

static void Publish(IOrganizationService service)
{
    service.Execute(new PublishAllXmlRequest());
    Console.WriteLine("Published customizations.");
}

static bool IsAlreadyExists(FaultException<OrganizationServiceFault> ex)
{
    return ex.Detail.Message.Contains("already", StringComparison.OrdinalIgnoreCase)
        || ex.Detail.Message.Contains("duplicate", StringComparison.OrdinalIgnoreCase);
}

static string ToLookupSchemaName(string logicalName)
{
    var parts = logicalName.Split('_');
    return $"{parts[0]}_{string.Join("_", parts.Skip(1).Select(part => char.ToUpperInvariant(part[0]) + part[1..]))}";
}

static string ToDisplayName(string logicalName) =>
    string.Join(" ", logicalName.Split('_').Select(part => char.ToUpperInvariant(part[0]) + part[1..]));

static Label Label(string text) => new(text, LanguageCode);

static AttributeRequiredLevelManagedProperty None() => new(AttributeRequiredLevel.None);
